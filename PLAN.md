# BetaCrux build plan

Written Saturday 16:00. Judging is Sunday 13:00 to 16:30, presented live.

Items marked **(to confirm)** depend on sponsor details that are still being checked.

## What we are building

Take a photo of a climbing wall. BetaCrux finds the holds, works out the best
sequence of moves for a climber of a given height, plays a stick figure
climbing it, and gives a grade. In live mode it watches a real person climb the
same route and a voice coach calls the next move.

## Track and prizes

Main track: **03, Voice, Vision & Generative Media**.

| Prize | Going for it | How BetaCrux uses it | Owner |
|---|---|---|---|
| Track 03 | Yes | The whole product | All |
| ElevenLabs bounty | Yes | Voice coach agent that looks up the solved route and calls the next move | Zaki |
| Adaption extra prize | Yes | Fine-tune a model on "description of a climb → grade" from our board data | Zaki |
| Figma extra prize | Yes | UI designed in Figma or Figma Make, with evidence in the slides | Adam |
| fal bounty | If time **(to confirm)** | A generated preview clip of the climb, or hosted hold segmentation | Zaki |
| Anam bounty | No | An avatar coach competes with the voice coach for the same hours | — |

## How it works, stage by stage

1. **Find holds.** Photo in, a list of holds out: position, size, colour, hold type.
2. **Pick the route.** The user taps one hold to select every hold of that
   colour (gym routes are colour-coded), then marks start and finish.
3. **Confirm unsure holds.** For each hold on the chosen route where the model
   is unsure of the type, the app shows a close-up and its top three guesses.
   The user taps the right one, or opens the full list. Only route holds are
   asked about, so this is a handful of taps, not the whole wall.
4. **Scale.** The user gives the height of wall visible in the photo, so pixels become metres.
5. **Solve.** The solver finds the cheapest sequence of hand moves, with reach set by climber height.
6. **Animate.** Each move becomes a body pose (hands, feet, hips, elbows, knees) drawn over the photo.
7. **Grade.** Features from the solved sequence go into the grade model.
8. **Live mode.** The camera stays fixed on the same framing as the photo. Pose
   tracking in the browser finds the climber's wrists, matches them to holds,
   and tracks progress through the sequence. The voice coach calls the next move.
9. **Physics (only if time).** Four limbs and a force-balance check per stance.

## The hold database

One file, `backend/hold_types.json`, lists every hold type the app knows. Each
entry has a name, a one-line description, an example picture, and a quality
score from 0 (worst) to 1 (best). The quality score is what the solver and the
grade model use, so a type chosen by the user and a type guessed by the model
are treated the same way.

- The frontend reads the list from `GET /hold-types` and never hard-codes it.
- If the type model is weak or missing, every hold is simply marked unsure and
  the user taps the type. The product still works.
- Each correction is saved as a labelled close-up of the hold. These are new
  training examples for the type model.

## The one shared thing: the API contract

Everything the frontend and backend exchange is in these two calls. All
positions are in pixels of the uploaded photo, so the frontend draws straight
onto it. The backend keeps no state: the frontend sends the full hold list
back, including the user's corrections.

`POST /analyze` (photo upload) returns:

```json
{
  "image": {"w": 1920, "h": 1440},
  "holds": [
    {"id": 0, "x": 495, "y": 430, "w": 60, "h": 110,
     "type": "jug", "quality": 0.9, "color": "#c0303a", "score": 0.81,
     "needs_review": true,
     "suggestions": [{"type": "jug", "p": 0.48}, {"type": "pinch", "p": 0.31}, {"type": "sloper", "p": 0.12}]}
  ]
}
```

`type` is one of the ids in the hold database: `jug`, `crimp`, `sloper`,
`pinch`, `pocket`, `volume`, `foot`, `unknown`. `quality` runs from 0 (worst)
to 1 (best). `needs_review` is true when the model's top guess is below a set
confidence. `suggestions` are its top three guesses, best first.

`GET /hold-types` returns the hold database:

```json
[{"id": "jug", "name": "Jug", "quality": 0.9,
  "description": "Deep, positive hold you can wrap your whole hand around", "image": "/hold-types/jug.jpg"}]
```

When the user picks a type, the frontend sets that hold's `type`, copies the
`quality` from the hold database, and sets `needs_review` to false before
calling `/solve`.

`POST /solve` takes:

```json
{
  "image": {"w": 1920, "h": 1440},
  "holds": [ ...the holds on the chosen route, same shape as above... ],
  "start": [3, 7],
  "finish": [22],
  "climber_height_m": 1.75,
  "wall_height_m": 4.0,
  "wall_angle_deg": 0
}
```

and returns:

```json
{
  "grade": {"font": "6a", "v": "V3", "low": "5c", "high": "6a+"},
  "crux": 3,
  "moves": [
    {"i": 0, "limb": "RH", "hold": 12, "load": 0.42, "span_m": 1.2}
  ],
  "keyframes": [
    {"move": 0, "joints": {
      "head": [600, 500], "hip": [600, 700],
      "lh": [540, 420], "rh": [660, 400], "l_elbow": [550, 480], "r_elbow": [650, 470],
      "lf": [560, 900], "rf": [640, 910], "l_knee": [570, 800], "r_knee": [630, 810]}}
  ]
}
```

`limb` is `LH`, `RH`, `LF` or `RF`. `crux` is the index of the hardest move.
`keyframes[0]` is the starting pose; each later keyframe is the pose after that move.

Rule: nobody changes the contract without telling the other two first.

## Repository layout and merge rules

One public GitHub repo. Each folder has one owner, and nobody edits outside their folder.

| Folder | Owner | Contents |
|---|---|---|
| `contract/` | Krishna | This contract, plus `analyze.json`, `solve.json` and `wall.jpg` as fixed examples |
| `backend/` | Krishna | Detector, solver, grade model, the two API calls |
| `frontend/` | Adam | The web app |
| `coach/` | Zaki | Voice agent prompt and tool definitions |
| `adaption/` | Zaki | Fine-tune dataset builder and results |
| `docs/` | Zaki | Slides, demo videos, validation photos |
| `README.md` | Zaki | Others send Zaki their lines, including every API, model and dataset used |

- Everyone pushes straight to `main` with `git pull --rebase` first. With
  separate folders there is nothing to conflict.
- Adam builds against the files in `contract/` until the real backend is up, so
  the frontend is never blocked on the backend.

## Steps for each person

### Krishna: backend and ML

| When | Step | Done when |
|---|---|---|
| Sat 16:00 | K1. Create the repo and folders. Move the existing code into `backend/`. Commit the contract examples. | Adam can load `contract/analyze.json` |
| Sat 16:30 | K2. Serve `/analyze` and `/solve`. `/analyze` starts with the zero-shot finder already in `detect_holds.py`; `/solve` uses the existing solver and the Kilter grade model. | Both calls answer from Adam's laptop |
| Sat 17:30 | K3. Train the hold detector on a labelled hold dataset from Roboflow (needs the free API key). Measure how many holds it finds on held-out photos and on our own gym photos. | Detector finds clearly more holds than the zero-shot finder (15 to 35%) |
| Sat 19:30 | K3b. Write the hold database and serve it at `/hold-types`. Add the top three type guesses and `needs_review` to `/analyze`. | Example file shows an unsure hold with three suggestions |
| Sat 20:00 | K4. Take hold quality from the hold database. Scale reach by climber height. Turn each move into a body pose for the keyframes. | Changing height changes the sequence |
| Sat 22:00 | K5. Swap the trained detector into `/analyze`. | End to end on a new photo |
| Sun 08:00 | K6. Score the grade model on Zaki's tagged gym routes. | One real-world number for the slides |
| Sun 09:00 | K7. Only if everything above is done: four-limb physics. | — |

### Adam: frontend

| When | Step | Done when |
|---|---|---|
| Sat 16:00 | A1. Design four screens in Figma: upload, review holds, route and climber, play. Save screenshots of the Figma work as evidence. | Screens agreed |
| Sat 17:30 | A2. Scaffold the app. Show the photo with holds drawn on it from `contract/analyze.json`. | Holds visible over the photo |
| Sat 19:00 | A3. Tap a hold to select all holds of that colour. Add or delete a hold. Mark start and finish. Height slider. | A route can be picked and sent to `/solve` |
| Sat 20:00 | A3b. Unsure-hold review: step through route holds with `needs_review`, showing a close-up and three suggestion buttons, plus "other" for the full list from `/hold-types`. | Every route hold has a confirmed type in a few taps |
| Sat 21:00 | A4. Play the stick figure from the keyframes, moving smoothly between poses. Highlight the crux. Show the grade card. | Animation plays on the fixture and on the real backend |
| Sun 08:00 | A5. Live mode: camera or video, pose tracking in the browser, wrist matched to nearest hold, progress through the sequence. | Progress bar follows a filmed climb |
| Sun 10:00 | A6. Add the voice coach to the page using Zaki's agent. Polish. | Coach speaks the next move |

### Zaki: prizes, demo and presentation

| When | Step | Done when |
|---|---|---|
| Sat 16:00 | Z1. Sign up for ElevenLabs, Adaption and fal. Claim hackathon credits. Ask each sponsor table what they score on and when Devpost freezes. | Keys shared privately, never committed |
| Sat 16:30 | Z2. Adaption: turn each board climb into a short text description with the grade as the answer, and start the fine-tune early. **(to confirm: data format and run time)** | Run started |
| Sat 18:00 | Z3. Voice coach: write the agent prompt and its tools (get the route, get the next move, change climber height). Test it by talking to it. | Coach answers "what's my next move?" from `contract/solve.json` |
| Sat 19:30 | Z4. Film at a real wall with a fixed camera: a straight-on photo of the wall, then a teammate climbing two or three routes. Photograph 15 to 20 routes with their grade tags. | Footage and tagged photos in `docs/` |
| Sat 22:00 | Z5. README draft and Devpost page. | Draft submitted, editable |
| Sun 08:00 | Z6. Slides. fal clip if time. | Slides done by 11:00 |
| Sun 11:00 | Z7. Run rehearsals. | Three full run-throughs |

## Checkpoints

| When | Everyone should see |
|---|---|
| Sat 17:30 | Frontend shows holds from the example file; both API calls answer |
| Sat 20:00 | One photo goes all the way through to a grade |
| Sat 23:00 | Trained detector in, animation playing. Record a screen capture as the backup demo |
| Sun 09:30 | Live mode and voice coach working on the filmed climb |
| Sun 11:00 | Feature freeze. Only fixes after this. README and Devpost final |
| Sun 11:00 to 12:30 | Rehearse three times |

## The presentation

1. **Hook (20 seconds).** Show a wall photo and ask the judges what grade the blue route is.
2. **Photo to grade (60 seconds).** Upload the photo. Holds appear. Tap the blue
   route. The app asks about the one or two holds it is unsure of; tap the
   answer. The stick figure climbs it and the grade appears.
3. **Height change (20 seconds).** Drag height from 1.90 m to 1.55 m. The
   sequence changes. This shows it is a solver, not a lookup.
4. **Live climb (60 seconds).** Play the filmed climb next to the predicted
   sequence, with the voice coach calling moves. Use the filmed clip, not a live
   camera, unless the venue has a wall.
5. **Rigour (40 seconds).** One slide of numbers, below.
6. **Close (20 seconds).** Which sponsor tools we used and how, for the Figma and Adaption prizes.

### The rigour slide

| Claim | Number | Status |
|---|---|---|
| Grade error on MoonBoard, 20,710 climbs | 0.98 grade steps, against 1.67 for guessing the median | Measured |
| Grade error on Kilter, 54,362 rows | 1.39 grade steps, against 3.74 for guessing the median | Measured |
| Hold quality carries about half the signal | Error rises to 1.29 (MoonBoard) and 1.92 (Kilter) without it | Measured |
| Zero-shot hold finding | About 15 to 35% of holds found, counted by eye on three photos | Measured |
| Trained hold detector | Share of holds found | K3 |
| Grade error on real gym routes | Against the gym's own tags | K6 |

Say plainly that the board numbers are not gym accuracy. The gym-route number is the only real-world one.

## If we fall behind, cut in this order

1. fal clip
2. Physics
3. Live camera tracking (show the filmed climb side by side with the stick figure instead)
4. Adaption fine-tune
5. Voice coach tools (the coach just reads the sequence aloud)

The photo → holds → sequence → animation → grade path is never cut.
