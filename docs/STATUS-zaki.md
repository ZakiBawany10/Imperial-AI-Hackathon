# Status: Zaki's lane

Saturday 14 November, about 20:30. Fourth block: the coach re-tested with feet
against Krishna's live backend. Earlier blocks follow below.

## Fourth block: coach tested with feet on the live backend

- **Krishna's backend runs locally, unchanged**, on 127.0.0.1:8001. Its
  virtualenv is in `~/.cache/betacrux-backend` (Python 3.13 via uv, since this
  Mac only has 3.15), with bytecode writing off. Nothing was written into
  `backend/`. Steps are in `coach/README.md`.
  - **One missing system library:** LightGBM needs `libomp`. The proper fix is
    `brew install libomp`. I didn't install anything system-wide; instead the
    server uses the copy that ships with PyTorch, which works.
  - `/solve` didn't need the detector weights. I started it with
    `BETACRUX_WARM=0` so it skipped loading the 2 GB detector.
- **Live `/solve` on `contract/solve_request.json`:** 6 moves, `LH 166, LF 176,
  RH 53, LH 53, LF 146, LH 2`; crux is move 2; grade 6a+ (V3), range 6a to
  6b+.
- **Coach bug found and fixed.** The first move (left hand onto hold 166, where
  the right hand starts) was called "Left hand, up and right, about 80
  centimetres, to the jug." It's a match. `moves` doesn't say which start hold
  each hand is on, so the coach now reads that from the start pose,
  `keyframes[0]`. A regression test covers it. 21 tests pass.
- **What the coach says on the live route**, default merge mode:
  1. "Left hand, match on the jug."
  2. "Left foot up, then right hand, up, about 1.4 metres, to the jug." (crux)
  3. "Left hand, match on the jug."
  4. "Left foot up, then left hand, up and left, about 1.3 metres, to the jug."
  5. "That's the top. Route finished."
  In "call" mode the two foot moves are their own calls: "Left foot, up and
  left, about 60 centimetres, to the jug." and "Left foot, up, about 1.1
  metres, to the foot chip."
- **`talk_test.html`** now coaches from the live route when a backend address
  is filled in (or `?backend=http://127.0.0.1:8001`), and logs which source it
  used. The browser's CORS check passes: `server.py` allows any origin, so no
  fallback file and no fix for Krishna were needed. **Not yet tried with a
  real microphone.**
- **`node try_coach.mjs --live=http://127.0.0.1:8001`** rehearses the live
  route in the terminal.
- **Krishna's message:** the two resolved items are removed. New asks:
  re-commit `solve.json` and `solve_request.json` from the current solver;
  check the 1.37 m crux move (is `wall_height_m: 4.0` right for `wall.jpg`?);
  confirm `span_m` is the hand gap after the move. **Adam's message:** the
  "agent doesn't exist yet" line is now "live, I'll send the id", and there is
  a note on foot moves.
- **Root README:** the agent is live (id not in the repo), and moves include
  feet.
- The backend server is stopped.

## Third block: voice coach live

Pushed as `e998f12` and `74455aa`, `coach/` only.

- **Key.** It was in `coach/.env.example`, which git tracks, not in
  `coach/.env`. I moved it to `coach/.env` (gitignored, permissions 600) and
  put the example back to blank. It was never committed: a search of all git
  history finds it nowhere. The key check returned **200**.
- **Agent created** on the first `--apply`, with no errors or retries:
  - The agent id is in the gitignored `coach/agent_ids.json` and nowhere else
    (the repo is public). Send it to Adam directly.
  - Checked by GET: name "BetaCrux coach", all 3 client tools attached
    (`get_route`, `get_next_move`, `set_climber_height`), English, auth off.
  - Default voice (`ELEVENLABS_VOICE_ID` is blank), TTS model `eleven_v4_turbo`.
- **`coach/talk_test.html`:** talk to the agent in the browser, with Start and
  Stop buttons, a status line, and a live log of every tool call, its result
  and the transcript. To open it:

  ```bash
  python3 -m http.server 8000 --bind 127.0.0.1   # from the repo root
  # open http://localhost:8000/coach/talk_test.html
  ```

  Keep `--bind 127.0.0.1`. Without it anyone on the venue Wi-Fi could download
  `coach/.env`. The agent id fills in by itself from `agent_ids.json`. Not yet
  tried with a real microphone: **that's yours to do.**
- **Krishna's update answered two open questions.**
  - She committed `contract/` examples (`solve_request.json`, `solve.json`,
    `analyze.json`, `hold_types.json`, `wall.jpg`). The contract test now runs
    and passes: **20 of 20 tests pass, none skipped.** The coach, the
    rehearsal and the talk page now use her real route.
  - Wall feet are `"hold": null` (her commit `d795f56`), which the coach
    already handled.
  - I ran her solver on her example request (in a scratch environment, nothing
    written to `backend/`). It gives 6 moves, 2 of them feet. The coach turns
    them into 4 calls, for example "Left foot up, then right hand, up, about
    1.4 metres, to the jug." The crux lands on the right call in all three
    foot-move modes.

### Now out of date in the 18:40 status below

- The wall-feet question and the `contract/` request to Krishna are both done.
  Remove them from her message in `docs/messages_for_team.md` before sending.
- "ElevenLabs paused" is over.
- The root `README.md` still says "the ElevenLabs agent hasn't been created
  yet" and "moves are hand moves only". I didn't touch it this block (you said
  `coach/` only). Say if you want those two lines updated.
- Krishna added `backend/BENCHMARKS.md` with new numbers, such as 87% of holds
  found on 19 hand-labelled gym photos. Those walls overlap her training
  photos, so the numbers aren't independent. `docs/numbers.md` doesn't include
  them yet.

## Second block (18:40)

Pushed as `c49c594`. Only `coach/`, `adaption/`, `docs/` and the root
`README.md` were touched. No ElevenLabs or Adaption API was called.

1. **Coach ready for foot moves.**
   - On a test route mixing hands and feet, the default "merge" mode says:
     "Right foot up, then right hand, up, about 50 centimetres, to the crimp. /
     Feet up, then left hand, up, about 90 centimetres, to the sloper. / Feet up,
     then right hand, up and right, about a metre, to the jug. / Left hand, match
     on the jug." Rehearse it with `node try_coach.mjs --mixed`.
   - **Wall feet:** a foot move whose hold is `null`, missing, or not a route
     hold is described without a target ("Right foot, up, about 40
     centimetres."). It never crashes and is never counted as a match. I didn't
     invent a shape; the question is in Krishna's message.
   - **Fixed** a bug where two wall-foot moves in a row would have been
     announced as a "match", and changed "about 1.0 metres" to "about a metre".
   - **Contract test still skipped:** `contract/solve.json` still doesn't exist,
     so there was nothing to run it against.
   - Tests: 19 pass, 1 skipped.
2. **Adaption test rows now identical to Krishna's.** The builder copies her
   filter and split from `backend/test_thesis.py` and `train_grade.py`. That
   gives 20,710 problems, 16,568 train rows and 4,142 test rows. The proof: the
   median-guess baseline comes out at exactly her 1.674 / 14.4% / 66.7%. The
   ids are in `adaption/test_split_ids.csv` (problem id and grade only).
   - **Fixed a real bug:** my hold difficulty ran the wrong way. Krishna's code
     shows a high expert score means a good hold. All descriptions are now
     correct.
   - The baseline moved from 1.838 to 1.674 because the rows changed.
   - The split needs numpy and scikit-learn, installed in a gitignored
     `adaption/.venv`.
   - Tests: 9 pass.
3. **`docs/numbers.md`:** every measured result in `backend/results*.json` and
   `grade_meta.json`, with its source, compared against the plan's rigour slide.
4. **Root `README.md` draft:** what it does, architecture, how to run each part,
   results (from `numbers.md` only), and "Built with" with licences. Unconfirmed
   items are marked TODO.
5. **`docs/devpost.md` draft:** draws only on the README and `numbers.md`. One
   claim I'd first written wasn't backed by the numbers, so I replaced it.
6. **Krishna's message updated** in `docs/messages_for_team.md`: the wall-feet
   question, the test-row note, a caveat about her retrained model, and a
   request to update the plan's slide numbers.

## Slide numbers are stale

The rigour table in `Documents/PLAN.md` doesn't match the results files.
Details are in `docs/numbers.md`.

| Slide says | Files say | Why |
|---|---|---|
| MoonBoard 0.98 | 0.94 (solver features) | 0.98 was before the solver's reach penalty |
| Kilter 1.39 | 1.30 | Same reason |
| Without hold quality: 1.29 / 1.92 | 1.28 / 1.85 | Off by a little; "about half the signal" holds for MoonBoard (46%) but not Kilter (23%) |
| Zero-shot 15–35% by eye | 38%, measured on 50 photos | Now properly measured |
| Trained detector (pending) | 95% found | Now backed |
| Gym-route grade error (pending) | Nothing | **Not measured.** No number on the slide until it is |

`Documents/PLAN.md` is a shared file, so I didn't edit it. Either Krishna
updates it, or you name that file and ask me to.

## Waiting on you

1. **Send Krishna's message**, from `docs/messages_for_team.md`. It asks how wall
   feet will appear in `moves`, asks her to commit the `contract/` examples, and
   asks her to update the plan's slide numbers. Adam's message is unchanged and
   still to send.
2. **Check the README's TODOs.** Frontend run instructions and Figma (Adam);
   repo licence; MoonBoard data terms. Also confirm the team names and roles.
   I took the surnames from the git history.
3. **Adaption:** pick a model, and decide whether to let their augmentation top
   up 16,568 rows past their recommended 20,000. Then the upload and run, once
   you have a key.
4. **ElevenLabs:** still paused; steps below.
5. **Devpost:** fill the TODOs (Adaption result or "prepared", repo and video
   links, tags) before the freeze.

## Waiting on Krishna

- How a wall foot will appear in `moves` (`hold: null`, no `hold`, a special id,
  or never).
- `contract/solve.json`, `analyze.json` and `wall.jpg`. Her own README's `curl`
  examples point at `contract/wall.jpg` and `contract/solve_request.json`, which
  don't exist yet.
- Confirm that the Adaption comparison should use her held-out 0.942.
  `models/grade.txt` was retrained on all rows, test rows included, so scoring
  it on those rows would flatter it.
- Update the rigour table in `Documents/PLAN.md` (her file to edit, or yours to
  ask for).

## Things to know

- **Repo structure.** Adam committed 897 photos in a top-level
  `wall training images/` folder. It's outside every owned folder in
  `CLAUDE.md`, and no code uses it yet. I didn't touch it. Worth deciding
  whether it should move into `frontend/` or `backend/`. Note too that the
  repo is public and those photos carry a ShareAlike licence whose
  non-commercial status is disputed (see the README).
- **Licences.** The hold detector's training data, ClimbInst, is CC BY-NC-SA
  4.0 (non-commercial), and Ultralytics YOLO is AGPL-3.0. Fine for a hackathon
  demo, but the README says so plainly.
- **The served grade model has seen the MoonBoard test rows** (it was retrained
  on everything after the comparison). The held-out numbers in `numbers.md` are
  the right ones to present.

## Finishing ElevenLabs setup once you have a key

```bash
cd coach
cp .env.example .env              # .env is gitignored; never commit it
# edit .env: ELEVENLABS_API_KEY=...   (optional: ELEVENLABS_VOICE_ID=...)
node --test                       # all coach tests should pass
node setup_agent.mjs              # dry run: check the 3 tool requests + 1 agent request it prints
node setup_agent.mjs --apply      # creates 3 tools and the agent; saves ids to agent_ids.json
```

Then:

- If `--apply` fails partway, fix the cause and run `--apply` again. Ids created
  so far are saved, so nothing is duplicated.
- Send the agent id from `coach/agent_ids.json` to Adam directly (not via the
  repo).
- Test by talking to the agent in the ElevenLabs dashboard. Its tools run in the
  browser, so in the dashboard they will time out or error. That's expected; the
  coach should then say it can't see the route. The full test is in Adam's app.
- After changing `prompt.md` or `tools.json`, run `--apply` again. It updates the
  same agent and tools in place.

## Earlier (first block, 18:00)

- The setup script saves ids after every API call.
- `coach/.gitignore` keeps `agent_ids.json` off GitHub.
- Foot-move modes: merge (default), skip, call.
- First team messages written.
- First Adaption dataset built (since replaced by the version above).
