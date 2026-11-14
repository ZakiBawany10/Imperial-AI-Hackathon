# Numbers for the slides

Every measured result in the repo, with its source file. Compiled Saturday
14 November, 18:45, from the backend files as of commit `2909364`. If Krishna
re-runs a script, its file changes and this page goes stale.

**Units.** Grade error is the mean absolute error in grade steps, one step being
one Font grade (6a → 6a+ → 6b …). Kilter difficulty numbers are the same Font
steps (`backend/test_kilter.py`), so errors on the two boards are in the same
unit. "Exact" and "within 1" are shares of held-out climbs whose rounded
prediction is right, or off by at most one grade.

**None of these are gym-wall numbers.** The grade results are on two
training boards; the detector and type results are on held-out photos from the
datasets they were trained on.

## 1. Grade model: MoonBoard 2016

Source: `backend/results.json` (`backend/test_thesis.py`). 20,710 problems with
at least 2 repeats; 4,142 held out (20%, stratified by grade, seed 0), including
66 benchmarks.

| Model | Error | Exact | Within 1 |
|---|---|---|---|
| Always guess the median grade | 1.674 | 14.4% | 66.7% |
| Raw holds only (198 on/off flags) | 0.884 | 40.6% | 81.2% |
| Solver features only (24 numbers) | 0.938 | 39.0% | 78.8% |
| Raw holds + solver features | 0.856 | 42.0% | 82.5% |
| Same model, benchmarks only (n = 66) | 0.849 | 42.4% | 78.8% |

Also in the file:
- The solver found a sequence for 99.99% of problems.
- The expert hold score correlates with grade at 0.556. This is how the code
  decides that a high score means a good hold.

## 2. Grade model: MoonBoard with hold quality removed

Source: `backend/results_no_hold_quality.json` (`test_thesis.py --no-hold-quality`).
Same rows and split as section 1.

| Model | Error | Exact | Within 1 |
|---|---|---|---|
| Solver features only, no hold quality | 1.279 | 28.6% | 67.6% |
| Raw holds + solver features, no hold quality | 0.873 | 41.5% | 81.2% |

Removing hold quality raises the solver-only error from 0.938 to 1.279. Measured
against the median guess, that loses 46% of the improvement: (1.279 − 0.938) /
(1.674 − 0.938). When raw holds are also given, the loss is small (0.856 →
0.873), because the model can learn which grid positions are hard.

## 3. Grade model: Kilter

Source: `backend/results_kilter.json` (`backend/test_kilter.py`). 54,362 rows
(climb × wall angle) from 29,773 climbs, grades with at least 5 ascents; 10,664
rows held out, split by climb.

| Model | Error | Exact | Within 1 |
|---|---|---|---|
| Always guess the median grade | 3.740 | 8.8% | 19.6% |
| Wall angle only | 3.271 | 10.1% | 24.8% |
| Solver features, geometry only + angle | 1.853 | 17.3% | 48.9% |
| Solver features, learned hold quality + angle | 1.302 | 24.4% | 64.3% |
| Raw holds + angle | 1.550 | 21.6% | 56.7% |
| Raw holds + solver features + angle | 1.256 | 24.8% | 65.6% |
| Same model, climbs below 6b/V4 only (n = 3,847) | 1.361 | 23.6% | 62.6% |

Learned hold quality cuts solver-feature error from 1.853 to 1.302, which is
23% of the improvement over the median guess.

## 4. Grade model: what the API serves

Sources: `backend/results_grade_model.json` and `backend/models/grade_meta.json`
(`backend/train_grade.py`). Both files hold the same comparison table.

| Trained on | Tested on Kilter | Kilter below 6b/V4 (n = 3,847) | Tested on MoonBoard |
|---|---|---|---|
| Kilter only | 1.302 | 1.372 | 1.844 |
| Kilter + MoonBoard (**served**) | 1.310 | 1.386 | 0.942 |
| MoonBoard only | 3.442 | 5.686 | 0.938 |

- The served model is "kilter + moonboard". After the comparison it was
  retrained on **all** 75,072 rows (`grade_meta.json`: 54,362 Kilter + 20,710
  MoonBoard). The comparison numbers above come from the held-out runs, but the
  saved model has seen every row, test rows included. So any score of the
  saved model on these test rows would be inflated. For a fair comparison with
  the Adaption fine-tune, use the 0.942 above, not a fresh score of
  `models/grade.txt`.
- The served model also outputs a range: 15th and 85th percentile models
  (`grade_meta.json`: `quantiles`). Their coverage has not been measured.

## 5. Hold detector

Source: `backend/results_detector.json` (`backend/eval_detector.py`). The 50
ClimbInst test photos, 3,433 labelled holds. A hold counts as found when a
predicted box overlaps it with IoU ≥ 0.5.

| Detector | Holds found | Predictions that are real holds | Seconds per photo |
|---|---|---|---|
| Zero-shot (Grounding DINO) | 37.8% | 86.6% | 5.26 |
| Trained YOLO11s, whole photo | 91.4% | 89.9% | 0.15 |
| Trained YOLO11s, whole photo + tiles (**served**) | 94.9% | 85.8% | 0.21 |

The test photos come from the same dataset as the training photos.

## 6. Hold type classifier

Source: `backend/results_type.json` (`backend/train_type.py`). 2,737 holds from
gym photos the classifier never saw (split by original photo).

| | |
|---|---|
| Top guess right | 87.2% |
| Right type in the top three | 98.3% |
| Always guess the most common type | 42.5% |
| Share of holds it is confident about (not sent for review) | 92.3% |
| Top guess right, among confident holds | 90.6% |

By type: crimp 91.5%, jug 83.8%, pinch 79.8%, pocket 96.6%, sloper 77.4%,
volume 97.8%. The dataset has no foot class.

## 7. Adaption dataset (ours)

Source: `adaption/out/stats.json` (`adaption/build_dataset.py`; rebuild to
regenerate, since `out/` isn't committed). Same 20,710 problems and same 4,142
test rows as section 1. The ids are in `adaption/test_split_ids.csv`.

| | |
|---|---|
| Training rows (uploaded) | 16,568 |
| Test rows (held out) | 4,142, including 66 benchmarks |
| Median-guess baseline on the test rows | 1.674 error, 14.4% exact, 66.7% within 1 |

The baseline equals section 1's exactly, which confirms the rows are the same.
No fine-tune has been run, so there is no Adaption result yet.

## Against the rigour slide in `Documents/PLAN.md`

| Slide claim | Slide number | Files say | Verdict |
|---|---|---|---|
| Grade error on MoonBoard, 20,710 climbs | 0.98 vs 1.67 median | 0.938 (solver features), 0.856 (best, holds + solver), 0.942 (served model); median 1.674 | **Stale.** 0.98 was before the solver's reach penalty (backend/README.md). No file has 0.98. Use 0.94 for the solver-only model, which is what the slide's story is about. |
| Grade error on Kilter, 54,362 rows | 1.39 vs 3.74 median | 1.302 (solver + learned quality), 1.256 (best), 1.310 (served); median 3.740 | **Stale.** 1.39 was before the reach penalty. Use 1.30. The 3.74 matches. |
| Hold quality carries about half the signal | Error rises to 1.29 (MoonBoard) and 1.92 (Kilter) without it | 1.279 (MoonBoard), 1.853 (Kilter, geometry only) | **Both numbers off.** Use 1.28 and 1.85. "About half" holds for MoonBoard (46% of the gain) but not Kilter (23%). Suggest: "hold quality is up to half the signal". |
| Zero-shot hold finding | About 15 to 35%, by eye on three photos | 37.8% of 3,433 holds on 50 test photos | **Superseded** by a proper measurement. Use 38%. |
| Trained hold detector | K3 (pending) | 94.9% found (served, tiled); 91.4% whole photo | **Now backed.** Say "on held-out photos from the training dataset", not gym photos. |
| Grade error on real gym routes | K6 (pending) | No file | **Not backed.** Still to do: no gym route has been scored. The slide must not show a number here until one exists. |

Not on the slide but measured: the hold type classifier (87% top guess, 98% top
three, against 43% for always guessing the most common type).
