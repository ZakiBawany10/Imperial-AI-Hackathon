# backend/

Owner: Krishna

Hold finder, sequence solver, grade model, and the API that serves them.

## Run the API

```bash
cd backend
uv venv .venv --python 3.13 && uv pip install --python .venv/bin/python -r requirements.txt   # once
./run.sh                                                                                      # http://<this-laptop>:8010
```

Port 8010 by default; `PORT=9000 ./run.sh` to change it.

The trained weights (`models/holds.pt`, `models/holds_seg.pt`, `models/hold_type.pt`)
are in git, so a fresh clone runs the real models. `/depth` downloads Depth
Anything V2 Base (about 400 MB) from Hugging Face on first use.

| Call | Does | Time on an M5 laptop |
|---|---|---|
| `POST /analyze` (form field `file`) | Photo in, holds out | 0.3 to 1.5 s with the trained models, 4 to 10 s without |
| `POST /solve` (JSON) | Route in; moves, poses and grade out | under 0.1 s |
| `POST /depth` (form field `file`) | Photo in, greyscale relief PNG out (the 3D wall's shape) | about 1 s |
| `POST /climbs`, `GET /climbs`, `POST /climbs/similar` | Store a climb the live camera followed, list them, find climbs on similar routes (`climbs_store.py`) | instant |
| `GET /hold-types` | The hold database | instant |
| `GET /health` | `{"ok": true}` | instant |
| `GET /demo/3d.html` | The 3D demo: pick a climb, set height and strength, watch it climbed | — |
| `GET /demo/` | A plain test page: load a photo, click a route, mark start and finish, solve, watch the figure climb | — |

```bash
curl -F file=@../contract/wall.jpg localhost:8010/analyze
curl -X POST localhost:8010/solve -H 'Content-Type: application/json' -d @../contract/solve_request.json
```

Request and response shapes are in [contract/](../contract/).

## Put it online

```bash
cd backend && ./go_live.sh
```

Runs the API on this laptop (using its GPU), gives it a public https address
through a Cloudflare quick tunnel, then builds the frontend against that
address and uploads it to Vercel (project `ascend`:
https://ascend-climb.vercel.app). Needs `brew install cloudflared` and
`npx vercel login` once. The tunnel address changes every run, which is why
the frontend is rebuilt each time. The site works only while the laptop is
on, online and running the script; Ctrl-C takes the backend down. Nothing on
the laptop is reachable except port 8010. To add the voice coach, run it as
`VITE_ELEVENLABS_AGENT_ID=agent_... ./go_live.sh`.

## Files

| File | What it does |
|---|---|
| `server.py` | The API |
| `demo/index.html` | The test page at `/demo/` (not the product frontend, which is in `frontend/`) |
| `analyze.py` | `/analyze`: finds holds, samples each hold's colour, classifies its type |
| `detect_holds.py` | Zero-shot hold finder (Grounding DINO on overlapping tiles) |
| `detector_data.py`, `train_detector.py`, `detector.py` | Download a sample of ClimbInst, train a YOLO hold detector on it, run it |
| `eval_detector.py` | Share of labelled holds a detector finds |
| `type_data.py`, `train_type.py`, `hold_type.py` | Cut out labelled holds from gym photos, train and score the type classifier, run it |
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
- **The solver** minimises total move cost. A move costs more the further the
  hand travels, the worse the holds are, and the closer the span is to full
  reach (`STRETCH` in `beta_solver.py`). Without the reach term it skipped
  holds and made 1.5 m moves; adding it also cut grade error on both boards.
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
| Kilter only | 1.30 | 1.37 | 1.84 |
| Kilter + MoonBoard (served) | 1.31 | 1.39 | 0.94 |
| MoonBoard only | 3.44 | 5.69 | 0.94 |

MoonBoard 2016, 20,710 problems (`test_thesis.py`, `results.json`):

| Model | Avg error | Exact | Within 1 grade |
|---|---|---|---|
| Always guess the median grade | 1.67 | 14% | 67% |
| Solver features, hold quality removed | 1.28 | 29% | 68% |
| Solver features (24 numbers) | 0.94 | 39% | 79% |
| Raw holds only (198 on/off flags) | 0.88 | 41% | 81% |

Kilter, 54,362 rows from 29,773 climbs (`test_kilter.py`, `results_kilter.json`):

| Model | Avg error | Exact | Within 1 grade |
|---|---|---|---|
| Always guess the median grade | 3.74 | 9% | 20% |
| Solver features, geometry only + angle | 1.85 | 17% | 49% |
| Raw holds + angle | 1.55 | 22% | 57% |
| Solver features, learned hold quality + angle | 1.30 | 24% | 64% |

These are numbers on two training boards. They are not accuracy on gym walls;
no gym route has been scored yet.

Before the reach term was added to the solver the same tables read 0.98
(MoonBoard) and 1.39 (Kilter).

## Hold detector results

Share of labelled holds found on the 50 ClimbInst test photos (3,433 holds),
counted when a predicted box overlaps the labelled one with IoU of 0.5 or more
(`eval_detector.py`, `results_detector.json`):

| Detector | Holds found | Predictions that are real holds | Seconds per photo |
|---|---|---|---|
| Zero-shot (Grounding DINO, threshold 0.15) | 38% | 87% | 5.3 |
| Trained YOLO11s, whole photo | 91% | 90% | 0.15 |
| Trained YOLO11s, whole photo + tiles (served) | 95% | 86% | 0.21 |

Trained for 40 epochs on 300 ClimbInst photos (18,796 holds). The test photos
come from the same dataset, so this is not yet a number for our own gym photos.
A climber on the wall produces false holds: take the photo with the wall empty.

## Hold type results

2,737 holds from gym photos the classifier never saw (`train_type.py`, `results_type.json`):

| | |
|---|---|
| Top guess is right | 87% |
| Right type is in the top three | 98% |
| Always guessing the most common type | 43% |
| Holds it is confident about (not sent for review) | 92% of holds, 91% of those right |

By type: crimp 92%, jug 84%, pinch 80%, pocket 97%, sloper 77%, volume 98%.

The source dataset stores 648 gym photos as 2,149 augmented copies, and a third
of the photos have copies in more than one of its own train/validation/test
splits. `type_data.py` re-splits by original photo, so the numbers above are on
photos with no copy in training. The dataset has no foot class; `/analyze`
guesses "foot" for very small holds and always flags those for review.

## Reproduce

```bash
mkdir -p data/kilter_hf && curl -L -o data/kilter_hf/kilter_splits.sqlite \
  https://huggingface.co/datasets/Vilin97/KilterBoard/resolve/main/kilter_splits.sqlite
git clone --depth 1 https://github.com/jrchang612/MoonBoardRNN.git data/MoonBoardRNN
.venv/bin/python test_thesis.py data/MoonBoardRNN
.venv/bin/python test_kilter.py data/kilter_hf/kilter_splits.sqlite
.venv/bin/python train_grade.py data/kilter_hf/kilter_splits.sqlite data/MoonBoardRNN
.venv/bin/python detector_data.py 300 60      # about 1 GB download
.venv/bin/python eval_detector.py zero-shot
.venv/bin/python train_detector.py 40 && .venv/bin/python eval_detector.py models/holds.pt test tiled
mkdir -p data/holdtypes && curl -L -o data/holdtypes/holds.zip \
  https://www.kaggle.com/api/v1/datasets/download/diegospaziani/indoor-climbing-gym-hold-classification-dataset
.venv/bin/python type_data.py && .venv/bin/python train_type.py 12
```

`data/` is not committed.

## Models, datasets and libraries used

- Zero-shot fallback hold finder: [IDEA-Research/grounding-dino-base](https://huggingface.co/IDEA-Research/grounding-dino-base) (Apache-2.0), used zero-shot through Hugging Face Transformers and PyTorch.
- Hold detector training data: [ClimbVision/ClimbInst](https://huggingface.co/datasets/ClimbVision/ClimbInst) (CC BY-NC-SA 4.0), a random 300 training and 60 validation photos, plus its 50 test photos.
- Hold detector: [Ultralytics](https://github.com/ultralytics/ultralytics) YOLO11s (AGPL-3.0), pretrained on COCO, fine-tuned by us.
- Hold type training data: [Indoor Climbing Gym Hold Classification Dataset](https://www.kaggle.com/datasets/diegospaziani/indoor-climbing-gym-hold-classification-dataset) (Diego Spaziani, CC BY-SA 4.0), its real gym photos only.
- Hold type classifier: Ultralytics YOLO11n-cls (AGPL-3.0), pretrained on ImageNet, fine-tuned by us.
- MoonBoard 2016 problems and expert hold scores: [MoonBoardRNN](https://github.com/jrchang612/MoonBoardRNN) (Duh and Chang, 2020).
- Kilter board climbs: [Vilin97/KilterBoard](https://huggingface.co/datasets/Vilin97/KilterBoard) (MIT), built from BoardLib and the Kilter app.
- LightGBM, scikit-learn, pandas, numpy, Pillow, FastAPI, Uvicorn.
