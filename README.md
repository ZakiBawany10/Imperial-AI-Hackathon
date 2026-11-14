# BetaCrux

**Photo of a climbing wall in; the best sequence of moves, a stick figure
climbing it, and a grade out. Then a voice coach calls your next move while you
climb.**

Built in a weekend for Imperial AI Week (Track 03: Voice, Vision & Generative
Media).

> Draft. Items marked **TODO** aren't confirmed yet.

## What it does

1. **Find holds.** Upload a photo of a gym wall. A trained detector finds every
   hold and records its position, size, colour and type (jug, crimp, sloper,
   pinch, pocket, volume, foot).
2. **Pick the route.** Tap one hold to select every hold of that colour (gym
   routes are colour-coded), then mark the start and finish.
3. **Confirm unsure holds.** For each route hold the classifier is unsure about,
   the app shows a close-up and its top three guesses. That's a few taps, not
   the whole wall.
4. **Solve.** Given the climber's height and the wall's height, a solver finds
   the cheapest sequence of hand moves, then places the feet for each one, so
   the sequence includes foot moves. Change the height and the sequence
   changes: it's a solver, not a lookup.
5. **Animate and grade.** Each move becomes a stick-figure pose drawn over the
   photo, the hardest move is marked as the crux, and a grade model turns the
   solved sequence into a grade with a likely range.
6. **Coach.** A voice agent reads the solved route and calls the next move
   while you climb: "Left foot up, then right hand, up, about 1.4 metres, to
   the jug."

## How it fits together

```
photo ─► POST /analyze ─► holds (pixels, type, colour, confidence)
                               │  user picks route, confirms unsure holds, sets heights
                               ▼
         POST /solve ─► moves, crux, stick-figure keyframes, grade
                               │
           frontend ◄──────────┘──► voice coach (ElevenLabs agent, tools run in the browser)
```

- **Backend** (`backend/`, Python, FastAPI): hold detection and typing, the
  sequence solver, poses, and the grade model. It keeps no state: the frontend
  sends the full route back with each call.
- **Contract** (`contract/`): the request and response shapes the frontend and
  backend share. All positions are pixels in the uploaded photo.
- **Frontend** (`frontend/`): the web app. **TODO:** not committed yet.
- **Voice coach** (`coach/`): the agent prompt, three client tools and their
  browser-side handlers. The agent reads the `/solve` result the frontend
  already has, so the backend stays stateless.
- **Adaption** (`adaption/`): a "climb description → grade" dataset for
  fine-tuning a language model, built on the same test rows as the grade model
  so the two can be compared.

### Design notes

From `backend/README.md`:

- **The solver** is a shortest-path search (Dijkstra) over left-hand and
  right-hand positions. The feet are added afterwards (`backend/limbs.py`):
  for each hand move, a statics model compares footholds, or feet on the bare
  wall, and each foot change becomes its own move just before the hand move it
  is for. A move costs more the further the hand travels and the
  worse the holds are.
- **The grade model** is LightGBM on 24 numbers from the solved sequence, plus
  wall angle and the count of foot-only holds. It never sees which board a climb
  came from, so it can be given a gym route. Its range comes from 15th and 85th
  percentile models.
- **Climber height scales the wall, not the climber.** The solver's reach is
  fixed for a 1.75 m person; for a shorter climber the same wall is measured in
  smaller units, so every span is longer. Sequence, effort and grade follow.
- **The solver penalises near-full-reach moves.** Without that term it skipped
  holds and made 1.5 m moves; adding it also cut grade error on both boards.
- **Hold quality** (0 worst, 1 best) comes from each hold's type in the hold
  database, whether the classifier guessed it or the user confirmed it.
- **Honest splits.** The hold-type dataset stores each photo as several
  augmented copies, some in more than one of its own splits, so it is re-split
  by original photo. All results are on held-out data.

## Running it

### Backend

From `backend/README.md`. Needs [uv](https://github.com/astral-sh/uv) and Python 3.13.

```bash
cd backend
uv venv .venv --python 3.13 && uv pip install --python .venv/bin/python -r requirements.txt   # once
./run.sh                                                                                      # http://<this-laptop>:8010
```

Open `http://localhost:8010/demo/` for a plain test page: load a photo, click a
route, mark start and finish, solve, and watch the figure climb. The calls are
`POST /analyze`, `POST /solve`, `GET /hold-types` and `GET /health`.

The trained weights (`models/holds.pt`, `models/hold_type.pt`) aren't in git.
Without them, `/analyze` falls back to a zero-shot hold finder (about a 900 MB
download on first use). See "Reproduce" in `backend/README.md` to train them.

### Frontend

**TODO:** Adam to add run instructions once the app is committed.

### Voice coach

Needs Node 18 or later; no packages to install.

```bash
cd coach
node --test                     # tests
node try_coach.mjs              # rehearse what the coach says, offline
node setup_agent.mjs            # dry run: prints the ElevenLabs API requests, sends nothing
node setup_agent.mjs --apply    # creates the agent (needs ELEVENLABS_API_KEY in coach/.env)
```

The frontend passes `createCoachTools(...).clientTools` from
`coach/coachTools.js` to the ElevenLabs session; see `coach/README.md`.
The ElevenLabs agent is live. Its id isn't in the repo: the repo is public, and
anyone with the id could use our credits, so ask Zaki for it.
`coach/talk_test.html` talks to it from a browser; see `coach/README.md`.

### Adaption dataset

```bash
cd adaption
# download the MoonBoard data first: see adaption/README.md
python3 -m venv .venv && .venv/bin/pip install numpy scikit-learn
.venv/bin/python build_dataset.py
```

**TODO:** the fine-tune hasn't been run yet.

## Results so far

All numbers are from result files in `backend/` and are listed with their
sources in `docs/numbers.md`. Grade error is mean absolute error in Font grade
steps (6a → 6a+ is one step), on held-out climbs.

| What | Result | Baseline |
|---|---|---|
| Grade from solver features, MoonBoard 2016 (20,710 problems) | 0.94 grade steps | 1.67 (always guess the median) |
| Grade from solver features + learned hold quality, Kilter (54,362 rows) | 1.30 grade steps | 3.74 |
| Hold detector (served), 50 held-out ClimbInst photos | 95% of holds found | 38% (zero-shot) |
| Hold type classifier, 2,737 held-out holds | 87% top guess, 98% in top three | 43% (always guess the most common type) |

These are on climbing-board data and held-out photos from the training
datasets. **No gym route has been scored yet** (**TODO**: grade error on real
gym routes against the gym's own grades).

## Built with

### APIs and services

- [ElevenLabs Agents](https://elevenlabs.io/docs) — the voice coach, with
  client tools that run in the browser. Live; the agent id is kept out of the
  repo.
- [Adaption](https://docs.adaptionlabs.ai/) (Adaptive Data, AutoScientist) — the
  "description → grade" fine-tune. **TODO:** dataset prepared, nothing uploaded
  or run yet.
- [Figma](https://www.figma.com/) — UI design. **TODO:** confirm with Adam.

### Models

- [IDEA-Research/grounding-dino-base](https://huggingface.co/IDEA-Research/grounding-dino-base)
  (Apache-2.0): zero-shot fallback hold finder, via Hugging Face Transformers
  and PyTorch.
- [Ultralytics](https://github.com/ultralytics/ultralytics) YOLO11s (AGPL-3.0),
  pretrained on COCO and fine-tuned by us as the hold detector.
- Ultralytics YOLO11n-cls (AGPL-3.0), pretrained on ImageNet and fine-tuned by
  us as the hold type classifier.
- LightGBM grade model, trained by us on Kilter and MoonBoard data.

### Datasets

- **MoonBoard 2016 problems and expert hold scores** from
  [MoonBoardRNN](https://github.com/jrchang612/MoonBoardRNN) by Duh and Chang
  (2020). The repository is Apache-2.0. It contains data scraped from
  moonboard.com; **TODO:** check MoonBoard's own terms for that data. Used for
  the grade model and the Adaption dataset (setter names and other personal
  fields dropped).
- **Kilter Board climbs** from
  [Vilin97/KilterBoard](https://huggingface.co/datasets/Vilin97/KilterBoard)
  (MIT), built from BoardLib and the Kilter app. Used for the grade model.
- **[ClimbVision/ClimbInst](https://huggingface.co/datasets/ClimbVision/ClimbInst)**
  (CC BY-NC-SA 4.0): 300 training, 60 validation and 50 test photos for the
  hold detector. Non-commercial: the detector weights inherit that limit.
- **[Indoor Climbing Gym Hold Classification Dataset](https://www.kaggle.com/datasets/diegospaziani/indoor-climbing-gym-hold-classification-dataset)**
  by Diego Spaziani (CC BY-SA 4.0): real gym photos, for the hold type
  classifier.
- **[Indoor Climbing Gym Hold And Route Segmentation, v4](https://www.kaggle.com/datasets/tomasslama/indoor-climbing-gym-hold-segmentation)**
  by Tomáš Sláma: 897 photos in `wall training images/`. The Kaggle listing
  says CC BY-SA 4.0, but the
  [associated paper](https://github.com/xiaoxiae/Indoor-Climbing-Hold-and-Route-Segmentation)
  describes it as non-commercial ShareAlike. **TODO:** not used by any code yet.

### Libraries

FastAPI, Uvicorn, PyTorch, Hugging Face Transformers, Ultralytics, LightGBM,
scikit-learn, pandas, numpy and Pillow (backend); the ElevenLabs JavaScript
client (frontend, **TODO**).

## Team

| Who | Built |
|---|---|
| Krishna Trehan | Backend and ML: hold detection and typing, solver, poses, grade model, API |
| Adam Wilkinson | Frontend and UI design |
| Zaki Bawany | Voice coach, Adaption dataset, demo and presentation |

## Licence

**TODO:** no licence chosen for this repository yet. Note that the hold
detector's training data is non-commercial (CC BY-NC-SA 4.0) and Ultralytics
models are AGPL-3.0.
