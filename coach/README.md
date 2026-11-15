# coach/

Owner: Zaki

The BetaCrux voice coach: an ElevenLabs agent that talks a climber up a solved
route one move at a time. It reads the `/solve` result through three client
tools that run in the browser, so the backend stays stateless.

| File | What it is |
|---|---|
| `prompt.md` | The agent's system prompt |
| `tools.json` | The three client tool definitions (`get_route`, `get_next_move`, `set_climber_height`) |
| `agent.config.json` | Agent name, language, first message |
| `coachTools.js` | The tool handlers the frontend passes to the ElevenLabs session. No dependencies |
| `setup_agent.mjs` | Creates or updates the agent on ElevenLabs from the files above |
| `agent_ids.json` | Written by the setup script after each successful call: agent id and tool ids. Gitignored, see below |
| `try_coach.mjs` | Text-only rehearsal of what the coach would say. No network |
| `talk_test.html` | Browser page to talk to the live agent, with a log of every tool call |
| `mountCoach.js` | Drop-in coach for the app: `mountCoach` (widget) and `createCoach` (headless), with voice → speech fallback and the progress nudge |
| `videoProgress.js` | `createVideoProgress(video, timestamps)`: progress from a filmed climb, for demo mode |
| `demo_test.html` | Rehearse demo step 4: local video + `docs/demo_timestamps.json` + the coach |
| `*.d.ts` | Types for the frontend (TypeScript) |
| `mountCoach.test.js` | Tests for the nudge, video progress and fallback |
| `coachTools.test.js`, `test_fixture.js` | Tests, and test data in the contract's shape |

## Running it

Needs Node 18 or later. Nothing to install.

```bash
cd coach
node --test                    # tests
node try_coach.mjs             # rehearse the coach in the terminal
node setup_agent.mjs           # dry run: prints the API requests, sends nothing
node setup_agent.mjs --apply   # creates the agent (needs coach/.env, see .env.example)
```

If `--apply` fails halfway, run it again: every id created so far is already
saved in `agent_ids.json`, so it updates those instead of creating duplicates.

### Talking to the coach

`talk_test.html` connects to the live agent by voice, with Start and Stop
buttons, a status line, and a live log of every tool call, its result and the
transcript. Where the route comes from (the log says which):

1. With a backend address filled in: the page posts
   `contract/solve_request.json` to that backend's `/solve` and coaches from
   the live answer, which includes foot moves.
2. Otherwise `contract/solve.json`, the committed example. It predates foot
   moves, so it is hands only.
3. Otherwise the test fixture.

The microphone needs `http://localhost`, not `file://`. Use two terminals, both
bound to 127.0.0.1. The backend is run unchanged, with its virtualenv outside
the repo so nothing is written into `backend/`.

**Terminal 1: backend on port 8001.** The first time, set up a Python 3.13 venv
outside the repo:

```bash
B=~/.cache/betacrux-backend
python3 -m venv $B/uvtool && $B/uvtool/bin/pip install uv
UV_PYTHON_INSTALL_DIR=$B/pythons $B/uvtool/bin/uv venv $B/venv --python 3.13
$B/uvtool/bin/uv pip install --python $B/venv/bin/python -r backend/requirements.txt   # from the repo root
```

LightGBM needs `libomp`. Either `brew install libomp`, or point it at the copy
PyTorch ships (no system change):

```bash
mkdir -p $B/omp && ln -sf $B/venv/lib/python3.13/site-packages/torch/lib/libomp.dylib $B/omp/libomp.dylib
```

Then start it. `BETACRUX_WARM=0` skips loading the 2 GB hold detector, which
`/solve` doesn't use:

```bash
B=~/.cache/betacrux-backend
cd $B && PYTHONDONTWRITEBYTECODE=1 BETACRUX_WARM=0 DYLD_LIBRARY_PATH=$B/omp \
  $B/venv/bin/uvicorn server:app --app-dir "/path/to/repo/backend" --host 127.0.0.1 --port 8001
```

**Terminal 2: the page on port 8000**, from the repo root:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open
`http://localhost:8000/coach/talk_test.html?backend=http://127.0.0.1:8001` and
press Start.

Keep `--bind 127.0.0.1` on both. Without it they are reachable from the whole
network, and the page server serves every file in the repo, including
`coach/.env`.

The agent id fills in from `?agent=...`, from the last id typed, or from the
local `agent_ids.json`. With a backend, a height change calls `/solve` again;
without one it only re-labels the route.

To rehearse the live route in the terminal instead:
`node try_coach.mjs --live=http://127.0.0.1:8001` (add `--feet=call` or
`--feet=skip` for the other foot-move modes).

The tests, `try_coach.mjs` and `talk_test.html` use `contract/solve_request.json`,
`contract/solve.json` and `contract/hold_types.json` when they exist, and the
test fixture otherwise.

## Drop-in helpers (`mountCoach.js`, `videoProgress.js`)

The paste-ready guide for Adam is in `docs/messages_for_team.md`.

- `mountCoach(element, options)` renders a Start/Stop button, a status line and
  a caption. It returns `{ start, stop, destroy, setState, next }`.
  `createCoach(options)` is the same without a DOM, for an app's own UI.
- **Modes:** `"voice"` (default; the ElevenLabs agent), `"speech"` (the browser
  reads the same sentences aloud at a slightly slower rate, with a "Next move"
  button) and `"text"` (captions only).
- **Fallback:** if voice can't connect (no agent id, mic blocked, network), or
  errors or disconnects mid-session, it switches to `"speech"` from the move it
  was on, and the status line says why. With no browser speech, it switches to
  `"text"`.
- **The nudge:** when `getProgress()` goes up enough to finish a call, the
  coach calls the next move by itself.
  - In voice it sends the agent a user message ("Done. What's my next move?").
    A user message makes the agent respond; a contextual update would be silent
    (ElevenLabs client-to-server events docs). The agent then calls
    `get_next_move`, which reads `getProgress`, so it can't skip or repeat. If
    the agent is mid-sentence, the nudge waits for it to finish (at most 6 s).
  - In speech or text mode it reads the next sentence.
  - Progress inside a merged call (the foot done, the hand not yet) doesn't
    trigger anything. Going back restarts from that move.
  - A forward seek jumps straight to the current move.
- `createVideoProgress(video, moves_at_sec)` turns a clip into `getProgress`:
  `moves_at_sec[k]` is when `solve.moves[k]` is completed. It follows play,
  pause, seek and replay, and has `subscribe` so the coach reacts immediately
  rather than waiting for the poll.

### Rehearsing the demo (`demo_test.html`)

```bash
python3 -m http.server 8000 --bind 127.0.0.1   # from the repo root
# open http://localhost:8000/coach/demo_test.html   (add ?backend=http://127.0.0.1:8001 for the live route with feet)
```

1. Pick the video file. It stays local: nothing is uploaded.
2. Press "Load route + set up coach".
3. To make the timestamps, play the clip and press "Mark move done at current
   time" as each move in `solve.moves` finishes. The page warns if the count
   doesn't match the number of moves. Then "Copy JSON" into
   `docs/demo_timestamps.json`.
4. Press "Start coach", rewind the video, and play.

## For the frontend (Adam)

Import `createCoachTools` and pass its `clientTools` to the session. Tool names
must match `tools.json` exactly, which the tests check.

```js
import { Conversation } from "@elevenlabs/client";
import { createCoachTools } from "../coach/coachTools.js"; // adjust the path

const coach = createCoachTools({
  // The current /solve request body and its response, plus GET /hold-types if loaded.
  getState: () => ({ request: solveRequest, solve: solveResponse, holdTypes }),
  // Call /solve again with the new height and update the state getState returns.
  onHeightChange: async (heightM) => { await resolveWithHeight(heightM); },
  // Optional: highlight solve.moves[moveIndex] on the animation.
  onStepChange: (moveIndex) => setActiveMove(moveIndex),
  // Optional, live or demo mode: how many entries of solve.moves are completed.
  getProgress: null,
  // Optional: "merge" (default), "skip" or "call". See below.
  footMoves: "merge",
});

const conversation = await Conversation.startSession({
  agentId: AGENT_ID, // from Zaki directly; keep it out of the repo
  connectionType: "webrtc",
  clientTools: coach.clientTools,
});
```

- **Foot moves.** Calling every foot move is too much talk on the wall. By
  default (`"merge"`) foot moves are folded into the next hand move: "High left
  foot, then big move, right hand to the next jug up, up high, way out to your
  right." `"skip"` calls hand
  moves only; `"call"` calls every move. One coaching turn can therefore cover
  several entries of `solve.moves`; `onStepChange` and `getProgress` always use
  indices into `solve.moves`, so the UI doesn't need to know about this.
- Without `getProgress`, the coach keeps its own count and moves on when the
  climber says they made the move. With it, live-mode tracking decides.
- **Agent id:** the agent exists; Zaki sends the id to Adam directly. It is not
  in the repo: the repo is public and so is the agent (no auth, so no token
  server is needed), and anyone with the id could spend our ElevenLabs credits.
  Keep it in a gitignored env file in `frontend/`, for example `.env.local`.
- Every tool returns a JSON string. On a missing route it returns
  `{"error": ...}` and the coach says it can't see the route yet.

## How the coach talks

Like a coach on the mat, not a tape measure. For every move `get_next_move`
returns structured facts, a main sentence (`say`) and two or three
`phrasings`. The agent rotates between them, and the prompt forbids it from
adding any hold, direction or fact that isn't in the facts.

- **Reach** is sized against the climber's height (`climber_height_m`, and the
  photo's scale from `wall_height_m`). By hand travel as a fraction of height:
  under 0.2 "short reach", under 0.4 "reach", under 0.6 "long reach", under
  0.85 "big move", otherwise "jump for it".
- **Where:** placed against the body in the pose before the move (head, neck
  as the shoulder line, hip, knees, the other hand). For example "just above
  your head", "out to your right at shoulder height", "by your left knee",
  "just above your right hand".
- **Which hold:** the type, plus "big" or "small" ("little" for a crimp) when
  the hold's box is at least 1.6 times, or at most 0.6 times, the route's
  median. A colour is named only when it differs from most route holds, or
  from a nearby hold of the same type.
- **Landmarks:** "the finish jug", "the start jug", "the jug your right hand's
  on", "the jug your hands started on", "the next jug up" (hands only: no
  other hold of that type in between), and "just past the sloper" as an
  alternative phrasing.
- **Feet:** "High left foot", "Left foot up by your knee", "Drop your right
  foot", and "Smear" for a foot on the bare wall. Merged into a hand call, only
  the short form is used.
- **Crux:** `crux_tips` offers up to three short tips that fit the move (a big
  move gets "commit to it"; a wide one gets "hips in to the wall"). The agent
  says one.
- **Distance** is only in `how_far` ("about 1.4 metres"), for when the climber
  asks.

On Krishna's current example route, the coach now says: "Match hands on the
jug." / "High left foot, then big move, right hand to the next jug up, up
high, way out to your right." / "Match hands on the jug." / "Left foot up by
your knee, then long reach, right hand to the next jug up, up high, way out to
your right." / "Left foot up by your knee, then big move, left hand to the
finish jug, up high to your left." (crux) / "Match hands on the finish jug."

## How the coach reads the contract

Checked against Krishna's backend code (`backend/route.py`, `analyze.py`, `pose.py`):

- `crux` is an index into `moves`.
- A hold's `x`, `y` are its centre. This is only used if a keyframe is missing a
  limb, since keyframes give the limb positions directly.
- Left and right are image left and right, which is the climber's left and right
  when the photo is taken from behind them.
- `keyframes[i]` is the pose before `moves[i]` (`contract/README.md`).
- **Foot moves.** `/solve` now returns `LF`/`RF` moves as well as hands
  (Krishna's commit `d795f56`; `"limbs": "hands"` gives the old hands-only
  answer). The committed `contract/solve.json` is still hands-only.
  `node try_coach.mjs --live=http://127.0.0.1:8001` rehearses the live route;
  `--mixed` rehearses a mixed test route without a backend.
- **Start holds.** `moves` doesn't say which start hold each hand begins on, so
  the coach reads it from the start pose, `keyframes[0]`: a limb is on a hold
  if it is within the hold's size of its centre. A first move onto the other
  hand's start hold is then called as a match.
- `span_m` appears to be the gap between the two hands (or feet) after the
  move, not how far the limb travelled: it is 0 for a match. The coach
  measures travel from the keyframes instead.
- **Wall feet** are `"hold": null` (same commit). They are called as a smear
  ("Smear your right foot up, by your right knee."), never as a match. A `hold`
  that is missing or not a route hold is treated the same way.
- `load` (relative effort, 0 to 1), `span_m` and the new `physics` field are
  not used yet.
