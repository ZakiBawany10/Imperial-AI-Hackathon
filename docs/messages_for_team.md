# Messages for the team

Ready to paste. Written Saturday 14 November, about 17:00.

## For Krishna: contract questions

> Hi Krishna, four questions about the contract so the voice coach reads `/solve` correctly. No change needed if my guesses are right; just confirm.
>
> 1. **`crux`:** is it an index into `moves` (so `moves[crux]` is the hardest move), not into `keyframes`? I'm assuming `moves`.
> 2. **Hold `x`, `y`:** are they the centre of the hold or the top-left of its box (with `w`, `h` the size)? I'm assuming centre. The coach only falls back to hold positions when a keyframe is missing a limb, but Adam will need this to draw boxes correctly too.
> 3. **Left and right:** is `LH`/`RH` the climber's left and right, with the photo taken from behind the climber facing the wall (so image left = climber's left)? I'm assuming yes.
> 4. **Foot moves:** will `/solve` return `LF`/`RF` moves before physics lands, or hand moves only? The coach handles both (it folds foot moves into the next hand move), I just need to know what to expect.
>
> Also: when you commit `contract/solve.json` and `contract/analyze.json`, my tests pick them up automatically. And whenever you have the MoonBoard/Kilter board data, tell me where it lives; for now I've prepped the Adaption dataset from the public MoonBoard 2016 data.

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
