# Messages for the team

Ready to paste. Written Saturday 14 November, updated about 18:00 after reading the backend.

## For Krishna: contract check and two asks

Zaki: the four contract questions are all answered by Krishna's backend code (pushed late Saturday afternoon), so this message confirms rather than asks.

> Hi Krishna, I read your backend to check how the voice coach should read `/solve`. From the code I'm taking these as the contract; shout if any is about to change:
>
> 1. `crux` is an index into `moves` (`route.py`: max cost over `moves`).
> 2. Hold `x`, `y` are the centre of the box (`analyze.py`: `(x0 + x1) / 2`).
> 3. `LH`/`RH` are the climber's left and right, with image left = climber's left (`pose.py` puts the left hand on the image-left side).
> 4. `/solve` returns hand moves only (`LH`/`RH`); no foot moves until physics. The coach copes either way.
>
> Two asks:
> - Could you commit `contract/solve.json`, `contract/analyze.json` and `contract/wall.jpg` when you get a moment? My coach tests and Adam's frontend both pick them up automatically.
> - Where can I get the Kilter rows you trained on? I've built the Adaption dataset from the public MoonBoard 2016 scrape (22k rows, setter details dropped), but every MoonBoard row is the same 40° angle, and Kilter would add wall angle.

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
