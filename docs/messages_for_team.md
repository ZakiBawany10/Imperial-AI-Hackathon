# Messages for the team

Ready to paste. Written Saturday 14 November; Krishna's message updated about 18:45 after reading the backend again.

## For Krishna: foot moves, test rows, and two asks

Zaki: the earlier contract questions are answered by Krishna's code, so they appear as confirmations. The new question is how wall feet will appear in `moves`. The Kilter ask is gone too: the backend README says the data is the public Vilin97/KilterBoard dataset on Hugging Face.

> Hi Krishna, a few things from the coach and Adaption side.
>
> **Foot moves.** I hear `/solve` will start returning `LF`/`RF` moves. The coach is ready: by default it folds foot moves into the next hand call ("Feet up, then right hand, up, about 50 centimetres, to the crimp"). One question: today `pose.py` can put a foot on the wall rather than on a hold. **How will a wall foot appear in `moves`?** `"hold": null`, no `hold` key, a special id, or never as a move? I haven't guessed a shape. For now the coach just describes any move whose `hold` isn't a route hold as "Right foot, up, about 40 centimetres", with no target, and it doesn't crash on any of those three shapes.
>
> **Same test rows as your grade model.** I rebuilt the Adaption dataset to use exactly your MoonBoard filter and split from `test_thesis.py` / `train_grade.py`:
> - grade 6B to 8B+, start and finish holds, repeats ≥ 2, no hold listed twice, in the pickle's order;
> - `train_test_split(test_size=0.2, random_state=0, stratify=grade)`.
>
> That gives the same 20,710 problems and 4,142 test rows. The median-guess baseline on them comes out at exactly your 1.674 / 14.4% / 66.7%. The ids are in `adaption/test_split_ids.csv` (problem id and grade only). The only difference is the input: the fine-tune sees a text description of the climb (holds in metres, hold difficulty from the same expert tables), not your solver features. Scores should be directly comparable.
>
> One caveat for that comparison. `grade_meta.json` says the served model was retrained on all 75,072 rows after the comparison, MoonBoard test rows included. So I'll compare against your held-out 0.942 ("trained on kilter + moonboard, tested on moonboard"), not a fresh score of `models/grade.txt`. Does that match how you'd do it?
>
> **Confirmed from your code, shout if any changes:** `crux` indexes `moves`; hold `x`, `y` are the box centre; image left is the climber's left.
>
> **Asks:**
> - Could you commit `contract/solve.json`, `contract/analyze.json` and `contract/wall.jpg`? Your backend README's `curl` examples also point at `contract/wall.jpg` and `contract/solve_request.json`. My coach tests pick the files up automatically.
> - The slide numbers in `Documents/PLAN.md` are the pre-reach-penalty ones (0.98 and 1.39). I've listed the current ones from your results files in `docs/numbers.md`. Could you check it and update the plan's rigour table, since that file is shared?

## For Adam: wiring the voice coach

> Hi Adam, the voice coach is ready to wire in from `coach/` whenever you get to A6. Details are in `coach/README.md`; the short version:
>
> ```js
> import { Conversation } from "@elevenlabs/client";
> import { createCoachTools } from "../coach/coachTools.js"; // adjust the path; no dependencies
>
> const coach = createCoachTools({
>   getState: () => ({ request: solveRequest, solve: solveResponse, holdTypes }), // current /solve body + response
>   onHeightChange: async (heightM) => { await resolveWithHeight(heightM); },     // re-call /solve, update state
>   onStepChange: (moveIndex) => setActiveMove(moveIndex),                          // highlight solve.moves[moveIndex]
>   getProgress: null,                                                               // see the request below
> });
>
> await Conversation.startSession({ agentId: AGENT_ID, connectionType: "webrtc", clientTools: coach.clientTools });
> ```
>
> - **Agent ID comes later.** I'm still waiting on an ElevenLabs API key, so the agent doesn't exist yet. I'll send you the ID directly once it does. Please keep it out of the repo (the repo and the agent are both public); a gitignored `.env.local` in `frontend/` is fine.
> - You can build and test everything except the voice now: the tool functions are plain async functions, so you can call `coach.clientTools.get_next_move({ climber_finished_last_move: true })` from a button and check what it returns.
> - **Request: a demo-mode `getProgress`.** For demo step 4 (filmed climb with the coach calling moves), please add a demo mode where `getProgress` returns how many moves are done based on the video's current time and a list of timestamps, something like:
>
>   ```js
>   const DEMO_MOVE_TIMES = [/* seconds into the clip when each move in solve.moves completes; Zaki will send these */];
>   const getProgress = () => DEMO_MOVE_TIMES.filter((t) => video.currentTime >= t).length;
>   ```
>
>   I'll note the timestamps from the filmed climb and send them over. That way step 4 works even if live pose tracking isn't ready. The coach only reads `getProgress` when it calls `get_next_move`, so it's cheap.
