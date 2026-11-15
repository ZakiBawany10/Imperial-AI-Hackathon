# Ascend: how it works, end to end (for Krishna)

Photo of a gym wall in → every hold found → you pick a climb → the app works out how a climber
of your height and strength would climb it (hands and feet, with physics) → a 3D climber shows the
moves → a grade → a voice coach talks you up it, and the phone camera follows you as you climb.

Live: **https://ascend-climb.vercel.app**. The backend runs on Krishna's laptop (see Hosting).

## Who built what

| Person | Folder | What |
|---|---|---|
| Krishna | `backend/`, `contract/` | Hold finder, hold types, routes, solver, physics, grade, depth/3D, API |
| Adam | `frontend/` | The Ascend app (React/Vite/Tailwind), design, screens |
| Zaki | `coach/`, `adaption/`, `docs/` | ElevenLabs voice coach, Adaption dataset, Devpost |

Tonight (15 Nov) Krishna also changed the frontend (3D buttons, colour picker, live camera),
because the others were asleep. Adam needs telling.

## The pipeline

```
photo ──POST /analyze──► holds (box, type, quality, colour) + routes (colour groups)
      ──POST /depth────► relief map (what sticks out of the wall) ──► 3D wall mesh
user picks colour → start hold → top hold → confirms unsure hold types
      ──POST /solve────► moves (LH/RH/LF/RF onto holds), poses, physics per position,
                         chance of reaching the top, grade
app: 3D viewer plays it · voice coach reads it · live camera tracks you through it
```

The API contract is in `contract/README.md`. Example request and answer files sit next to it,
made by the real backend.

## 1. Finding holds: `/analyze` (`analyze.py`, `detector.py`)

- **Model:** YOLO11s, trained 40 epochs on 300 ClimbInst photos (18,796 holds). The photo is also
  cut into tiles so small holds are found (`models/holds.pt`, 19 MB, in git).
- **Results:**
  - **ClimbInst test photos (50, 3,433 holds):** finds **95%** of holds, against 38% for a model
    with no training (Grounding DINO). 86% of what it marks are real holds. 0.2 s per photo.
  - **19 hand-labelled photos from two real gyms:** finds 87%, and 95% of what it marks are real.
    Misses are small holds: under 20 px it finds 46%, over 40 px it finds 96%.
- **Caveats:**
  - The test walls overlap the training walls. Read the numbers as new camera angles of known walls.
  - Take the photo with nobody on the wall, or the climber gets marked as holds.

## 2. Hold types (`hold_type.py`, `models/hold_type.pt`)

- **Model:** YOLO11n classifier with 6 types: crimp, jug, pinch, pocket, sloper, volume.
- **Results on 2,737 unseen holds:**

  | | |
  |---|---|
  | Top guess right | **87%** |
  | Right type in the top 3 | **98%** |
  | Always guessing the most common type | 42% |
  | Confident guesses (60%+ sure) | 92% of holds, 91% of those right |

- **Why the app shows "~50% sure" guesses:** it only asks about the unsure 8%; the confident ones
  are filled in silently.
- **No "foot" type:** the training data has none, so small holds are guessed "foot" at 50% and
  always asked about.
- **Data leak found and fixed:** the source dataset had copies of the same photo in its train and
  test sets. `type_data.py` re-splits by original photo.
- **Each type has a quality (0–1)** in `hold_types.json`, used by the solver and the physics.

## 3. Routes and colours (`routes.py`)

- **How it groups:** gyms colour-code climbs, so holds are grouped by their own colour (read from
  the hold's pixels, not its box) and position. `/analyze` returns
  `routes: [{id, color, color_name, holds}]`.
- **Result on 8 photos with every route labelled (68 routes):** a route comes out as one clean
  group **43%** of the time, against 19% for the old "similar colour" rule. Within a group, 84% of
  the holds belong to the route.
- **Tonight's test:** we tried growing a route from the tapped hold's colour. Nothing beat the
  shipped grouping. The limit is colour itself:
  - shadows merge blue, purple, red and black;
  - one photo has 4 different green routes;
  - even a perfect per-tap threshold only gets about 52%.
- **So the app treats it as a suggestion** (Zaki's idea): a list of colour chips at the start. Tick
  one, or two if shadows split a climb. The photo lights that climb up and dims the rest, and one
  tap adds or removes a hold.

## 4. The solver (`route.py`, `beta_solver.py`, `limbs.py`)

- **Units:** everything is in climber-sized units, so a shorter climber just sees a "bigger" wall.
  Height is strictly **1.40–2.10 m**; strength runs 0.6–1.5, where 1.0 = a regular gym climber.
- **Hands:** a search over hand positions. The sequence shown is the **safest**: the shortest path
  where each move costs −log(1 − chance of falling on it).
- **Feet:** for each hand position, `limbs._Planner` picks footholds from the route's holds (or a
  smear on bare wall). Foot changes cost a little, and stepping down costs more.
- **Climb rules:** start standing on the floor with hands on the start hold(s); never touch the
  floor again; finish with both hands on the top hold.

## 5. The physics (`physics.py`, `pose.py`)

- **Model:** static 2.5D balance for each position. Each hand or foot can push or pull only in
  directions its hold allows: a jug almost any way, a crimp mostly down, a sloper only straight
  down. Hands have a grip limit set by hold quality × strength. Feet on holds are strong; a smear
  on bare wall gets only friction.
- **How it's solved:** "make the hardest-working hand work least while everything balances" is
  one small non-negative least-squares problem, about 50 µs per position.
- **Outputs:**
  - per move: `effort` (share of grip strength; ≥1 can't be held), `stable`, `fall_chance`;
  - per position: balance point and the force on each limb;
  - per climb: chance of reaching the top.
- **Trained against real climbers** (`train_physics.py`, `wayup.py`): The Way Up dataset, 22
  recorded climbs by 11 people on 8.5 m routes.
  - The engine picks its own sequence and is scored on hand holds, foot holds, order and which
    hand. Score 0.46 → **0.58** (experts 0.61). Hand holds 0.70 → 0.85; foot holds about 0.42.
  - A new setting ships only if it wins on both a random split and a held-out-route split.
- **Tonight:**
  - **Standing up:** the climber squatted under low start holds, so first moves came out
    impossible. They now stand up, start with feet on the floor and use low footholds. Standing
    starts on the demo walls went from 0–4% to **89–100%** chance of reaching the top. The real
    climbs score 0.587, up slightly from 0.58.
  - **Leaning out to smear:** with no foothold, the body may sit further out from the wall. That
    gives the feet more friction but makes the hands pull outward more; the solver keeps the
    easier. It changes little.
  - **Still impossible:** sit starts (hands under ~60 cm), and climbs with no foothold of their
    own colour low down.

## 6. Grade (`train_grade.py`)

- **Model:** LightGBM on 24 numbers from the solved sequence, plus wall angle. Trained on the
  Kilter and MoonBoard training boards. The 15th and 85th percentile models give the range.
- **Average error:** **1.31 grade steps** on Kilter (middle-grade guess: 3.74) and **0.94** on
  MoonBoard (1.67).
- **Does the move sequence help?** On Kilter, yes: 1.30 against 1.55 from the hold list alone.
- **On a real gym-style wall (The A, 110 problems):** no better than guessing, about 2.2 V grades
  off. Grading on gym walls is unsolved. It was handed to Zaki; Adaption has the dataset built but
  nothing trained.

## 7. 3D (`depth.py`, `demo/viewer/betacrux-viewer.js`)

- **Relief map:** Depth Anything V2 Base gives depth. Subtracting a wide blur leaves what sticks
  out, and each hold found by the outline model (`holds_seg.pt`, YOLO11s-seg) becomes a dome.
- **Tested on 19 photos with every hold outlined:** a pixel inside a hold has more relief than one
  of bare wall **94%** of the time, and 95% of holds are raised.
- **Viewer:** three.js, product ("paper") theme, a jointed 3D climber that animates the moves,
  click a hold for a close-up. In the app: 3D wall on/off and Reset view.

## 8. The app (Adam)

1. **Photo:** example walls, or take or upload one.
2. **Route:** colour chips → start hold → top hold → answer the unsure hold types.
3. **You:** height and strength (changing either re-solves).
4. **Beta:** 3D climb, grade, crux, effort per move.

Then **Live mode**: the coach and the camera.

## 9. Voice coach (Zaki, `coach/`)

- **The agent:** ElevenLabs, with 3 tools that run in the browser (`get_route`, `get_next_move`,
  `set_climber_height`), so it only ever says what the solver gave it.
- **How it talks:** like a coach ("big move, right hand to the next jug up"), not in metres.
- **Fallback:** if voice fails, it switches to the browser reading the moves aloud. 36 tests.
- **The agent id is not on the live site yet** (it needs `VITE_ELEVENLABS_AGENT_ID` from Zaki).
  Until then it reads the moves aloud.

## 10. Live camera (tonight, `frontend/src/lib/tracker.ts`)

- **Set-up:** the phone stays where it took the wall photo. The photo shows faintly over the video
  to line them up.
- **Tracking:** MediaPipe Pose runs in the browser and tracks fingertips and toes.
- **Counting moves:** a move is done when a hand (or foot) reaches the next hold and stays there
  0.35 s. Either hand counts, because seen from behind left and right get mixed up. A hand already
  on the hold doesn't count, which handles matching.
- **Drives the coach:** it feeds the coach's progress, so the coach calls the next move by itself.
  There are manual ‹ and Done › buttons as back-up.
- **Records the climb:** every hand and foot landing on a route hold, with timestamps. When the
  camera stops it goes to `POST /climbs`. "Use a filmed climb" runs the same tracker on a video
  file, which is how tomorrow's footage gets processed.
- **Tested:**
  - On a real indoor clip filmed from behind (Wikimedia, CC BY-SA, 204×360): the climber was found
    in **99.9%** of frames, with 30 limb-on-hold events recorded in 30 s.
  - The camera flow, in headless Chrome with a fake camera.
  - **Not yet tested with a tripod on a real route.**

## 11. Hosting

- **Frontend:** a static build on Vercel (project `ascend`).
- **Backend:** FastAPI on the laptop (port 8010, using the Mac's GPU), made public by a Cloudflare
  quick tunnel: an outbound connection, no open ports, free https.
- **One command:** `cd backend && ./go_live.sh` starts the backend, opens the tunnel, rebuilds the
  frontend against the new address and uploads it.
- **Why not all on Vercel:** the models need about 3–4 GB of memory, kept loaded.
- **Catch:** the site works only while the laptop is on and online. At the gym a phone hotspot is
  fine.
- **Model weights are in git** (holds 19 MB, outlines 21 MB, types 3 MB), so any laptop runs the
  real models.

## 12. Pitch angles

- **Physics, not guesswork:** every move has forces, effort and a chance of falling, tuned on 22
  real recorded climbs and checked on held-out routes.
- **Personal:** the same wall is a different climb for a 1.55 m beginner and a 1.90 m strong
  climber.
- **Accessibility:** the app sees colours for you and the voice tells you which hold to grab, so
  it works for colourblind climbers.
- **Continuous improvement (built tonight, `backend/climbs_store.py`):** every tracked climb is
  - saved (`POST /climbs`, in The Way Up's format);
  - found again for similar routes (`POST /climbs/similar`, shown as "Climbs like this" and on the
    Live screen; this is the retrieval/RAG part);
  - added to physics training: `ASCEND_CLIMBS=1 python3 train_physics.py` retrains on Way Up plus
    ours and scores ours alone. New settings ship only if they still win on both held-out tests.

  One slide: climb → tracked → saved → app gets better.
- **Social:** a Share button and "Climbs like this" on the Play screen use real stored climbs only.
  Livestreaming to friends is pitch only.
- **Accuracy in the app:** "How it works" lists the real numbers, including the weak ones.

## 13. Honest limits (for judges' questions)

- **Grading on real gym walls is not solved** (no better than guessing on The A).
- **Route grouping is right about half the time**, hence the pick-and-correct design.
- **Detector test walls overlap its training walls**, and small holds are often missed.
- **Physics is static:** no dynos or momentum; sit starts are wrong.
- **The live camera hasn't been tested on a real climber yet.**
- **Licences:** the depth model is non-commercial (CC BY-NC); fine for a hackathon.

## Where things are

| Need | File |
|---|---|
| API shapes | `contract/README.md` |
| Every number with its caveat | `backend/BENCHMARKS.md`, `backend/results_*.json` |
| How the backend works and reproduces | `backend/README.md` |
| Run / put online | `backend/run.sh`, `backend/go_live.sh` |
| What's left | `todo.txt` |
