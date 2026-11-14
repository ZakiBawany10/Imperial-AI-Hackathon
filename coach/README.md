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
transcript. It uses `contract/solve.json` and `contract/analyze.json` when they
exist, and the test fixture otherwise. The microphone needs `http://localhost`,
not `file://`, so serve the repo root:

```bash
python3 -m http.server 8000 --bind 127.0.0.1   # from the repo root; open http://localhost:8000/coach/talk_test.html
```

Keep `--bind 127.0.0.1`. Without it the server is reachable from the whole
network, and it serves every file in the repo, including `coach/.env`.

The agent id fills in from `?agent=...`, from the last id typed, or from the
local `agent_ids.json`. Height changes only re-label the route unless you give
a backend URL (for example `http://localhost:8010`), in which case the page
calls `/solve` again.

The tests and `try_coach.mjs` use `contract/solve.json` and
`contract/analyze.json` when they exist, and the test fixture otherwise.

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
  default (`"merge"`) foot moves are folded into the next hand move: "Feet up,
  then right hand, up, about 50 centimetres, to the crimp." `"skip"` calls hand
  moves only; `"call"` calls every move. One coaching turn can therefore cover
  several entries of `solve.moves`; `onStepChange` and `getProgress` always use
  indices into `solve.moves`, so the UI doesn't need to know about this.
- Without `getProgress`, the coach keeps its own count and moves on when the
  climber says they made the move. With it, live-mode tracking decides.
- **Agent id:** Zaki sends it to Adam directly once the agent exists. It is not
  in the repo: the repo is public and so is the agent (no auth, so no token
  server is needed), and anyone with the id could spend our ElevenLabs credits.
  Keep it in a gitignored env file in `frontend/`, for example `.env.local`.
- Every tool returns a JSON string. On a missing route it returns
  `{"error": ...}` and the coach says it can't see the route yet.

## How the coach reads the contract

Checked against Krishna's backend code (`backend/route.py`, `analyze.py`, `pose.py`):

- `crux` is an index into `moves`.
- A hold's `x`, `y` are its centre. This is only used if a keyframe is missing a
  limb, since keyframes give the limb positions directly.
- Left and right are image left and right, which is the climber's left and right
  when the photo is taken from behind them.
- `/solve` currently returns hand moves only. Krishna is adding foot moves; the
  coach is ready for them (`node try_coach.mjs --mixed` rehearses a mixed route).
- **Wall feet:** the contract doesn't yet say how a foot on the wall (not on a
  hold) appears in `moves`; the question is with Krishna. Meanwhile any move
  whose `hold` is `null`, missing, or not a route hold is described without a
  target ("Right foot, up, about 40 centimetres."), never as a match, and never
  crashes.
- `load` (relative effort, 0 to 1) and `span_m` are not used yet.
