# Messages for the team

Ready to paste. Written Saturday 14 November; Krishna's message updated about 20:30 after running her current backend locally.

## For Krishna: foot moves, test rows, and four asks

Zaki: the wall-feet question and the request for `contract/` files are resolved (her commit `d795f56` and the committed examples), so they're gone. New: re-commit the examples from the current solver, and a sanity check on one long move.

> Hi Krishna, a few things from the coach and Adaption side.
>
> **Foot moves.** Thanks for `d795f56`. I ran your backend locally, unchanged, and posted `contract/solve_request.json` to `/solve`. It returns 6 moves (`LH 166, LF 176, RH 53, LH 53, LF 146, LH 2`), and the coach handles them. By default it folds each foot move into the next hand call: "High left foot, then big move, right hand to the next jug up, up high, way out to your right." Wall feet as `"hold": null` work too.
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
> - **Could you re-commit `contract/solve.json` and `contract/solve_request.json` from the current solver?** The committed `solve.json` predates foot moves: it has 4 hand moves and no `physics` field, while the live answer to the same request has 6 moves including `LF`. Adam and the coach both build against these files.
> - **Could you sanity-check the 1.37 m hand move in that example?** Move 2 (`RH` to hold 53, the crux) has `span_m: 1.37`. The request says `wall_height_m: 4.0` for the 1440 px photo, so 360 px per metre, and the hand travels from y 1020 to 528, about 490 px. If the photo shows less than the full 4 m of wall, every distance is overstated, and the coach says "about 1.4 metres" aloud. Is 4.0 m right for `wall.jpg`, or is it just the default?
> - Small one: I read `span_m` as the gap between the two hands (or feet) after the move, not how far the limb travelled, because it's 0 for a match. Right? The coach measures travel from the keyframes, so either way is fine.
> - The slide numbers in `Documents/PLAN.md` are the pre-reach-penalty ones (0.98 and 1.39). I've listed the current ones from your results files in `docs/numbers.md`. Could you check it and update the plan's rigour table, since that file is shared?

## For Adam: wiring the voice coach (about 10 minutes)

> Hi Adam, the coach now comes as drop-in helpers in `coach/`, with fallback and demo mode built in. Everything below uses your existing `@coach` alias and `getState`/`onHeightChange` from `App.tsx`.
>
> **1. Types (one line).** In `frontend/tsconfig.json`, add `"@coach/*": ["../coach/*"]` to `paths`. `coach/` now ships `.d.ts` files for `coachTools.js`, `mountCoach.js` and `videoProgress.js`, so you can delete `src/coach.d.ts`.
>
> **2. Agent id.** It goes in your gitignored `frontend/.env.local` as `VITE_ELEVENLABS_AGENT_ID=...` (the name you already use). Never put it in code: the repo is public. I'll DM you the id.
>
> **3a. Keep your own UI (recommended):** inside `useCoach` in `src/lib/coach.ts`, replace `createCoachTools` + `Conversation.startSession` with `createCoach`. It drives your existing status and error state:
>
> ```ts
> import { createCoach } from "@coach/mountCoach.js";
>
> const coach = createCoach({
>   agentId: import.meta.env.VITE_ELEVENLABS_AGENT_ID,
>   getState: () => opts.current.getState(),              // same as now: { request, solve, holdTypes }
>   onHeightChange: (h) => opts.current.onHeightChange(h), // same as now: re-POST /solve
>   onStepChange: (i) => opts.current.onStep(i),
>   onStatus: ({ status, message }) => { setStatus(status === "idle" || status === "error" ? "off" : status); setError(message); },
>   onCaption: (text) => setCaption(text),                 // optional: the current move sentence
> });
> // coach.start() / coach.stop() on your mic button
> ```
>
> **3b. Or the ready-made widget** (Start/Stop button, status line, caption) in any `<div>`:
>
> ```tsx
> const ref = useRef<HTMLDivElement>(null);
> useEffect(() => {
>   const c = mountCoach(ref.current!, { agentId: import.meta.env.VITE_ELEVENLABS_AGENT_ID, getState, onHeightChange });
>   return () => { void c.destroy(); };
> }, []);
> ```
>
> **4. Filmed-climb screen (demo step 4).** Pass a `getProgress` built from the video, and the coach calls each move by itself as the clip reaches it. It also restarts from the right move if you scrub back:
>
> ```ts
> import { createVideoProgress } from "@coach/videoProgress.js";
> import demo from "../../../docs/demo_timestamps.json"; // from frontend/src/<folder>/; { video, moves_at_sec }, I'll fill it in
> const getProgress = createVideoProgress(videoRef.current!, demo.moves_at_sec);
> // createCoach({ ...same options, getProgress }) or mountCoach(el, { ...same options, getProgress })
> ```
>
> For that JSON import, add `'../docs'` to `server.fs.allow` in `vite.config.ts`, or I can send you the numbers to paste in.
>
> **Things to know:**
> - If voice can't connect (no id, mic blocked, network), or drops mid-climb, it switches by itself to the browser reading the same sentences aloud, and says so in the status. The demo never goes silent. You can also force `mode: "speech"` or `mode: "text"`.
> - `onStepChange` still gives the index into `solve.moves`, foot moves included.
> - It uses your installed `@elevenlabs/client` (1.32.1); no new packages.
> - To try it outside the app: `coach/demo_test.html` (see `coach/README.md`).
