# adaption/

Owner: Zaki

The dataset for the Adaption extra prize: fine-tune a model on "short text
description of a climb → grade". **Prep only so far:** nothing has been uploaded
and no run has been started.

| File | What it is |
|---|---|
| `build_dataset.py` | Builds `out/train.csv` and `out/test.csv` from the MoonBoard 2016 scrape. Standard library only |
| `test_build_dataset.py` | Tests on a tiny synthetic scrape: filtering, de-duplication, split, no personal fields, safe loading |
| `data/raw/` | Downloaded source data. Gitignored |
| `out/` | Built dataset. Gitignored; rebuild it with the script |

## Building the dataset

```bash
cd adaption
B=https://raw.githubusercontent.com/jrchang612/MoonBoardRNN/master/raw_data
mkdir -p data/raw
for f in moonGen_scrape_2016_final HoldFeature2016LeftHand.csv HoldFeature2016RightHand.csv; do
  curl -sSfL -o "data/raw/$f" "$B/$f"
done
python3 build_dataset.py          # writes out/train.csv, out/test.csv, out/stats.json
python3 -m unittest test_build_dataset.py
```

Source: [jrchang612/MoonBoardRNN](https://github.com/jrchang612/MoonBoardRNN),
Apache-2.0. The scrape is a Python pickle. The builder loads it with every class
import blocked, so a tampered file can't run code. I also checked the downloaded
file's opcodes before loading it: it contains only dicts, lists, strings and
numbers. SHA-256 of the copy used:
`19c5322b6d0d446ac63d1291268ff4eb800687dec0df4c3bc63404e3080318ec`.

## What the dataset looks like

One row per MoonBoard 2016 problem:

| instruction | response |
|---|---|
| Wall angle 40 degrees overhanging. 7 hand holds, 2 start and 1 finish. Height climbed 2.8 m. Hold difficulty (0 easy, 9 hard): mean 6.0, hardest 8. Longest gap 0.7 m, mean gap 0.6 m. Start on a 4, then up 0.2 m left 0.6 m to an 8; up 0.6 m right 0.4 m to a 4; … | 6B+ |

- **No MoonBoard grid names in the text.** Descriptions use metres and a 0–9
  hold difficulty, so `describe_route()` can describe a gym route solved by
  BetaCrux in exactly the same words (hold difficulty = 9 × (1 − quality)).
  That's what makes the fine-tuned model usable on our own routes.
- **Grade:** the setter's Font grade (6B to 8B+). The user-voted grade is kept in
  `test.csv` for comparison but is missing for 70% of problems.
- **Filtering:** problems nobody repeated are dropped (5,525), since their grade
  is only the setter's opinion, but benchmarks are always kept. 40 duplicate hold
  sets are dropped, keeping the most-repeated copy. Change this with
  `--min-repeats`.
- **Split:** 10% of problems by hashed problem id (stable across machines), plus
  all 367 benchmarks, go to `test.csv`. The test file is never uploaded.
- **Personal data dropped:** the scrape has each setter's name, nickname, city,
  country and profile picture, and a URL with the problem's name. None of it is
  read into the output, and a test checks this.

Current build (`out/stats.json`):

| | Rows |
|---|---|
| Source problems | 30,642 |
| Train (`out/train.csv`, the upload) | 22,236 |
| Test (`out/test.csv`, held out) | 2,841, including 367 benchmarks |
| Baseline: always guess the median (6C+) | 1.84 grade steps mean error on test |

The grades are skewed: 36% of the training rows are 6B+, the board's lowest
common grade. A model that learns little will hover around the median, so
compare against the 1.84 baseline, not against zero.

## What a run will need

Confirmed in Adaption's docs (docs.adaptionlabs.ai, read 2026-11-14; `adaption`
Python SDK 0.19.0 on PyPI):

- **File format:** CSV is accepted (also JSON, JSONL, Parquet).
- **Upload:** `client.datasets.upload_file("out/train.csv", processing_mode="raw", column_mapping={"prompt": "instruction", "completion": "response"})`.
  Our column names match their AutoScientist quickstart example exactly. Then
  poll `client.datasets.get_status(dataset_id)` until `row_count` is set.
- **Run:** `client.autoscientist.create(dataset_id=..., model=...)`. `model` is
  optional; if omitted, AutoScientist picks one. Then
  `client.autoscientist.wait_for_completion(run.id)`.
- **Key:** `ADAPTION_API_KEY` in the environment (keys start `pt_live_`).
- **Size:** SFT needs at least 1,000 rows on every model; 20,000 is their
  recommended quality target. We have 22,236 without augmentation. 10,000-row
  minimums apply only to the larger Gemma, Qwen and NVIDIA models.
- **Row length:** far under every model's limit. Rows average 96 words (max 220),
  and over-long rows are truncated, not rejected.
- **Output:** a downloadable checkpoint (`best-checkpoint.tgz`) and a
  `best_win_rate`. This is not a hosted endpoint.

Assumed or not found in the docs:

- **Run time and credit cost:** not stated anywhere I could find. Ask at the
  Adaption table.
- **Evaluation:** their docs mention only `best_win_rate`. Grade accuracy has to
  be measured ourselves on `out/test.csv` (mean error in grade steps, against the
  1.84 baseline). Because the output is a checkpoint, not an endpoint, scoring
  it means either running the model somewhere or asking Adaption whether they
  host inference.
- **Augmentation:** their quickstart recommends mixing in general-purpose rows
  (40%) against forgetting. For a narrow classification-style task we may want
  none. Untested.
- **Hold difficulty direction:** I assumed a higher number in the source's
  `Difficulties` column means a harder hold. The source doesn't document it.
- **Grid spacing:** I assumed about 0.2 m between MoonBoard grid positions. It
  only rescales distances, but gym-route descriptions should use the same scale.
- **Wall angle:** fixed at 40°, the MoonBoard 2016 setup. Every row has the same
  angle, so the model learns nothing about angle from this data.

## Not done yet

- Upload and run: waiting for a model choice and the Adaption key (in a local
  `.env`, never committed).
- Kilter data from Krishna: when it arrives, add a second loader. Kilter has
  many wall angles, which fixes the fixed-angle gap above.
- A scoring script for `out/test.csv` once we know how to run the fine-tuned model.
