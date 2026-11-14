# Status: Zaki's lane

Saturday 14 November, 18:40. Written by Zaki's agent while Zaki was away.
Second block of work; the first block's status (18:00) is summarised at the end.

## What changed in this block

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
