# adaption/

Owner: Zaki

The dataset for the Adaption extra prize: fine-tune a model on "short text
description of a climb → grade". **Prep only so far:** nothing has been uploaded
and no run has been started.

| File | What it is |
|---|---|
| `build_dataset.py` | Builds `out/train.csv` and `out/test.csv` from the MoonBoard 2016 scrape, using Krishna's exact filter and test split |
| `test_split_ids.csv` | The 4,142 test rows: problem id and grade only. Committed, so anyone can check they score on the same rows |
| `test_build_dataset.py` | Tests on a tiny synthetic scrape |
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
python3 -m venv .venv && .venv/bin/pip install numpy scikit-learn   # for Krishna's split; .venv is gitignored
.venv/bin/python build_dataset.py      # writes out/train.csv, out/test.csv, out/stats.json, test_split_ids.csv
.venv/bin/python -m unittest test_build_dataset.py
```

Without numpy and scikit-learn, `python3 build_dataset.py --split hash` still
works using only the standard library. It produces different test rows, so it
doesn't rewrite `test_split_ids.csv`.

Source: [jrchang612/MoonBoardRNN](https://github.com/jrchang612/MoonBoardRNN),
Apache-2.0. The scrape is a Python pickle. The builder loads it with every class
import blocked, so a tampered file can't run code. I also checked the downloaded
file's opcodes before loading it: it contains only dicts, lists, strings and
numbers. SHA-256 of the copy used:
`19c5322b6d0d446ac63d1291268ff4eb800687dec0df4c3bc63404e3080318ec`.

## Same rows as Krishna's grade model

The filter and split copy `backend/test_thesis.py` and `backend/train_grade.py`:

- **Filter:** grade 6B to 8B+, has start and finish holds, at least 2 repeats,
  no hold listed twice. Problems are kept in the pickle's order. Duplicate hold
  sets across problems are kept, and benchmarks get no exemption, as in her code.
- **Split:** scikit-learn `train_test_split(test_size=0.2, random_state=0,
  stratify=grade)`, the same call on the same inputs.

**Check:** 20,710 problems kept and 4,142 test rows. The median-guess baseline
on them is 1.674 error, 14.4% exact and 66.7% within one grade. That is exactly
her `backend/results.json`, so the rows are identical. Built with scikit-learn
1.9.1 and numpy 2.5.4. If a different version ever changed the split, this
baseline check would stop matching.

**Comparing with her model:** use her held-out MoonBoard result, 0.942 ("trained
on kilter + moonboard, tested on moonboard", `results_grade_model.json`). Don't
re-score `backend/models/grade.txt` on these rows: it was retrained on all
MoonBoard rows afterwards, including these test rows. See `docs/numbers.md`.

## What the dataset looks like

One row per problem:

| instruction | response |
|---|---|
| Wall angle 40 degrees overhanging. 7 hand holds, 2 start and 1 finish. Height climbed 3.0 m. Hold difficulty (0 easy, 9 hard): mean 2.3, hardest 5. Longest gap 1.2 m, mean gap 0.9 m. Start on a 2, then up 0.4 m right 0.8 m to a 2; up 0.8 m left 0.4 m to a 5; … | 6B+ |

- **No MoonBoard grid names in the text.** Descriptions use metres and a 0–9
  hold difficulty, so `describe_route()` can describe a gym route solved by
  BetaCrux in the same words (hold difficulty = 9 × (1 − quality)).
  That's what would make the fine-tuned model usable on our own routes.
- **Hold difficulty** = 9 − the expert score. A high expert score means a good
  hold, which Krishna checked against grades (correlation 0.556,
  `backend/results.json`). The first version of this builder had it the wrong
  way round; that's fixed.
- **Grid spacing** about 0.2 m, the figure Krishna's solver also uses.
- **Grade:** the setter's Font grade. The user-voted grade is kept in
  `test.csv` for comparison but is missing for most problems.
- **Personal data dropped:** the scrape has each setter's name, nickname, city,
  country and profile picture, and a URL with the problem's name. None of it is
  read into the output, and a test checks this.

Current build (`out/stats.json`):

| | Rows |
|---|---|
| Source problems | 30,642 |
| Kept (repeats ≥ 2 etc.) | 20,710 |
| Train (`out/train.csv`, the upload) | 16,568 |
| Test (`out/test.csv`, held out) | 4,142, including 66 benchmarks |
| Baseline: always guess the training median (6C) | 1.674 grade steps mean error on test |

The grades are skewed: 39% of training rows are 6B+, the board's lowest common
grade. A model that learns little will hover near the median, so compare against
1.674, and against Krishna's 0.942, not against zero.

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
  recommended quality target, not a requirement. We have 16,568 without
  augmentation. That's above every SFT minimum, including the 10,000-row ones
  for the larger Gemma, Qwen and NVIDIA models. Their augmentation could top it
  up past 20,000.
- **Row length:** far under every model's limit. Over-long rows are truncated,
  not rejected.
- **Output:** a downloadable checkpoint (`best-checkpoint.tgz`) and a
  `best_win_rate`. This is not a hosted endpoint.

Assumed or not found in the docs:

- **Run time and credit cost:** not stated anywhere I could find. Ask at the
  Adaption table.
- **Evaluation:** their docs mention only `best_win_rate`. Grade error has to be
  measured ourselves on `out/test.csv`. Because the output is a checkpoint, that
  means running the model somewhere, or asking Adaption whether they host
  inference.
- **Augmentation:** their quickstart recommends mixing in general-purpose rows
  (40%) against forgetting. For a narrow classification-style task we may want
  none. Untested.
- **Wall angle:** fixed at 40°, the MoonBoard 2016 setup. Every row has the same
  angle, so the model learns nothing about angle from this data.

## Not done yet

- Upload and run: waiting for a model choice and the Adaption key (in a local
  `.env`, never committed).
- Kilter rows: the data is public (`huggingface.co/datasets/Vilin97/KilterBoard`,
  MIT, per `backend/README.md`) and would add wall angle. To stay comparable,
  copy Krishna's Kilter filter and split from `backend/test_kilter.py` (at least
  5 ascents; `GroupShuffleSplit`, 20% test, seed 0, grouped by climb).
- A scoring script for `out/test.csv` once we know how to run the fine-tuned model.
