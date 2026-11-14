# backend/

Owner: Krishna

Hold finder, sequence solver, grade model, and the API that serves them.

## Run the API

```bash
cd backend
uv venv .venv --python 3.13 && uv pip install --python .venv/bin/python -r requirements.txt   # once
./run.sh                                                                                      # http://<this-laptop>:8010
```

Port 8010 by default; `PORT=9000 ./run.sh` to change it. The first start
downloads the hold finder (about 900 MB) from Hugging Face.

| Call | Does | Time on an M5 laptop |
|---|---|---|
| `POST /analyze` (form field `file`) | Photo in, holds out | 4 to 10 s |
| `POST /solve` (JSON) | Route in; moves, poses and grade out | under 0.1 s |
| `GET /hold-types` | The hold database | instant |
| `GET /health` | `{"ok": true}` | instant |

```bash
curl -F file=@../contract/wall.jpg localhost:8010/analyze
curl -X POST localhost:8010/solve -H 'Content-Type: application/json' -d @../contract/solve_request.json
```

Request and response shapes are in [contract/](../contract/).

## Files

| File | What it does |
|---|---|
| `server.py` | The API |
| `analyze.py` | `/analyze`: runs the hold finder, samples each hold's colour, guesses its type from size |
| `detect_holds.py` | Zero-shot hold finder (Grounding DINO on overlapping tiles) |
| `route.py` | `/solve`: pixels to solver units, solver, grade |
| `beta_solver.py` | Dijkstra over (left hand, right hand) positions |
| `pose.py` | Stick-figure pose for each position |
| `hold_types.json`, `hold_types/` | The hold database and its pictures |
| `train_grade.py` | Trains the grade model saved in `models/` |
| `test_thesis.py`, `test_kilter.py` | The two grade experiments below |
| `safe_load.py` | Reads the MoonBoard pickle files without letting them run code |

## How the pieces work

- **Climber height** scales the wall, not the climber. The solver's reach is
  fixed for a 1.75 m person; for a shorter person the same wall is measured in
  smaller units, so every span is longer. Sequence, load and grade all follow.
- **Hold quality** (0 worst, 1 best) comes from the hold's type in
  `hold_types.json`. The solver uses `1 - quality` as how bad a hold is.
- **Grade** is a LightGBM model on 24 numbers from the solved sequence, plus
  wall angle and the count of foot-only holds. `low` and `high` are its 15th
  and 85th percentile models.
- **Two processes.** `/solve` runs in a worker process. LightGBM and PyTorch
  each bring their own OpenMP library and crash on macOS if one process uses both.

## Grade model results

Error is in grade steps (6a, 6a+, 6b …). Lower is better. 20% of climbs held out.

Served model, from `train_grade.py` (`results_grade_model.json`):

| Trained on | Kilter error | Kilter below 6b error | MoonBoard error |
|---|---|---|---|
| Kilter only | 1.39 | 1.44 | 1.95 |
| Kilter + MoonBoard (served) | 1.39 | 1.46 | 0.98 |
| MoonBoard only | 3.58 | 5.87 | 0.98 |

MoonBoard 2016, 20,710 problems (`test_thesis.py`, `results.json`):

| Model | Avg error | Exact | Within 1 grade |
|---|---|---|---|
| Always guess the median grade | 1.67 | 14% | 67% |
| Solver features, hold quality removed | 1.29 | 28% | 67% |
| Solver features (24 numbers) | 0.98 | 38% | 77% |
| Raw holds only (198 on/off flags) | 0.88 | 41% | 81% |

Kilter, 54,362 rows from 29,773 climbs (`test_kilter.py`, `results_kilter.json`):

| Model | Avg error | Exact | Within 1 grade |
|---|---|---|---|
| Always guess the median grade | 3.74 | 9% | 20% |
| Solver features, geometry only + angle | 1.92 | 17% | 47% |
| Raw holds + angle | 1.55 | 22% | 57% |
| Solver features, learned hold quality + angle | 1.39 | 22% | 61% |

These are numbers on two training boards. They are not accuracy on gym walls;
no gym route has been scored yet.

## Reproduce

```bash
mkdir -p data/kilter_hf && curl -L -o data/kilter_hf/kilter_splits.sqlite \
  https://huggingface.co/datasets/Vilin97/KilterBoard/resolve/main/kilter_splits.sqlite
git clone --depth 1 https://github.com/jrchang612/MoonBoardRNN.git data/MoonBoardRNN
.venv/bin/python test_thesis.py data/MoonBoardRNN
.venv/bin/python test_kilter.py data/kilter_hf/kilter_splits.sqlite
.venv/bin/python train_grade.py data/kilter_hf/kilter_splits.sqlite data/MoonBoardRNN
```

`data/` is not committed.

## Models, datasets and libraries used

- Hold finder: [IDEA-Research/grounding-dino-base](https://huggingface.co/IDEA-Research/grounding-dino-base) (Apache-2.0), used zero-shot through Hugging Face Transformers and PyTorch.
- MoonBoard 2016 problems and expert hold scores: [MoonBoardRNN](https://github.com/jrchang612/MoonBoardRNN) (Duh and Chang, 2020).
- Kilter board climbs: [Vilin97/KilterBoard](https://huggingface.co/datasets/Vilin97/KilterBoard) (MIT), built from BoardLib and the Kilter app.
- LightGBM, scikit-learn, pandas, numpy, Pillow, FastAPI, Uvicorn.
