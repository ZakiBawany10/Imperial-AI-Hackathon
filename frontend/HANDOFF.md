# Frontend handoff (Adam, app name: Ascend)

Read this first, then `../CLAUDE.md` (repo rules, **including section 6: Krishna's instructions to this agent**),
`../contract/README.md` (API contract + physics fields) and `../Documents/PLAN.md` (plan).
Last updated: Sun 15 Nov 2026 ~01:45, after commit `37272c7` (Ascend rebrand + Krishna's section 6 done).

## Who and where
- Working for **Adam**. Only write inside `frontend/`. Check `git config user.name` contains "Adam" before editing.
- Repo: `~/imperial-ai-hackathon` (public GitHub `ZakiBawany10/Imperial-AI-Hackathon`, everyone pushes to `main`).
- Git: `git add frontend/` only; check `git status` that nothing outside `frontend/` is staged. `git pull --rebase` before every push. Never force-push. No `.env` or keys. Commit/push only when Adam asks.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Read-only: `contract/`, `backend/` (Krishna); `coach/`, `adaption/`, `docs/`, root README (Zaki); `Documents/`, every `CLAUDE.md`, `.gitignore`. Need a change there -> tell Adam exactly what to ask the owner. Don't copy teammates' code into `frontend/`; reimplement ideas or import at runtime.
- `wall training images/` at the root holds datasets Adam added (incl. `300-graded-gym-problems`, `videos/` link manifest). Not used by the app.

## Run it
```
# backend (Krishna's), needed for EVERYTHING now (no offline example):
cd ~/imperial-ai-hackathon/backend && ./run.sh          # :8010; needs backend/.venv (Krishna's setup)
#   the last session ran it from a scratchpad venv instead:  PYTHONDONTWRITEBYTECODE=1 BETACRUX_WARM=0 <venv>/bin/uvicorn server:app --host 127.0.0.1 --port 8010
# frontend:
cd ~/imperial-ai-hackathon/frontend
npx pnpm@10 install
PORT=5173 FIGMA_DEV_SERVER_HOST=localhost npx pnpm@10 run dev     # Adam usually has this running already
npx tsc --noEmit && npx pnpm@10 run build
```
- API base: `VITE_API_URL`, else `http://<page host>:8010`. Backend has CORS `*`.
- Trained detector weights (`backend/models/holds.pt`, `hold_type.pt`) are NOT in git and NOT on this laptop; `/analyze` uses the zero-shot fallback here (works, weaker). Ask Krishna for the .pt files for the demo laptop.

## Stack and files
React 19 + Vite 8 + Tailwind v4 + TS, originally a Figma Make export (`.figma/` kept; `.figma/make/site.json` sets the page title "Ascend").
- `src/App.tsx`: `Flow` (real app: upload -> finding -> review -> route -> solving -> play -> live) and `Board` (all design frames, desktop; `?frame=2B` shows one). Phone layout at <=520px or coarse pointer.
- `src/screens/`: `Upload.tsx` (drop zone + examples + finding sheet + How it works), `Review.tsx` (route picking), `Route.tsx` ("You": height, strength, wall height, angle; also `RouteOverlay`, `routeStroke`, `StrengthPicker`), `Play.tsx` (3D viewer / 2D climber, timeline, grade, effort, weight, height+strength; `LiveScreen`).
- `src/lib/`: `api.ts` (analyze, solve, depth, hold-types, `HEIGHT_RANGE` 1.40-2.10, `STRENGTHS`), `contract.ts` (`prepare` analyze -> overlay holds, `selectRoute`, `buildSolve`), `beta.ts` (`BetaView`: moves/effort/fall, poses, loads, start/finish; `realBeta`, `mockBeta`), `coach.ts` (`useCoach` over Zaki's `createCoach`), `wall.ts` (palette `C`, mock data for Board, hold shapes).
- `src/ui/`: `kit.tsx` (Screen, TopBar with `StepRoute` progress, Btn, BottomSheet, WallPhoto, HoldShape...), `HoldPins.tsx` (`HoldGlyph`, `HoldPin`, `HoldTick`), `WallSketch.tsx` (drop-zone ink drawing), `Logo.tsx` (`Wordmark` with rock "d"; `LogoGlyph` winged-A, now unused).
- `public/`: `logo.svg` (app icon source: plain white A on #243E36), icons rendered from it, `manifest.webmanifest` ("Ascend"), `sw.js` (cache `ascend-v2`).
- Aliases: `@contract` -> `../contract`, `@coach` -> `../coach` (read-only imports), `@elevenlabs/client` -> frontend's node_modules (coach/ has none). `tsconfig` paths include `@coach/*` (coach ships .d.ts).

## Current state (all on main at 37272c7)
- **Krishna's CLAUDE.md section 6: all five done.**
  1. Examples = `${API_URL}/demo/walls/wall-1.jpg` (4.3 m) and `wall-2.jpg` (4.0 m), always through live `/analyze`. No saved answers, no offline fallback (removed contract example, Seattle photos, EXAMPLE_SOLVE).
  2. Physics shown on Play: per-move effort bar ("44% of full grip strength", red >= 0.82, "Too hard to hold" >= 1), fall chance, chance to top, "Weight on" bars per limb (keyframe `physics.forces[].share`). Foot moves and `hold: null` handled.
  3. `strength` sent in /solve (picker on You and Play: 0.7/1.0/1.25/1.5); height 1.40-2.10. Height/strength change on Play re-solves (300 ms debounce). Coach `set_climber_height` rejects outside 1.40-2.10.
  4. Play uses Krishna's 3D viewer: dynamic `import(\`${API_URL}/demo/viewer/betacrux-viewer.js\`)`, `mountViewer(el, {imageUrl, reliefUrl, analyze, solveRequest, solve, theme:"paper", mesh:false, hud:false, autoplay:false, loop:false})`; our play/pause/next/prev/timeline/speed drive it (`play/pause/seek/setSpeed`, `on("move")`, `setSolve` on re-solve). `/depth` relief fetched while solving. If the import fails, the 2D human climber draws instead. Live mode stays 2D (overlay on camera).
  5. Review is start-first: tap the start hold (its colour picks the climb via `selectRoute`) -> tap the top hold or CTA "Use the highest as the top" -> answer type questions -> "Next: set climber".
- **Review UX**: step strip Start / Top / Types n/m with hold-shaped ticks; one bottom CTA that names the next action; tapping a route hold opens a menu (start / finish / type / remove); tapping an off-route hold adds it; auto-zoom to the route, "Show whole wall"; "Pinch to zoom" hint is click-through when not zoomed.
- **Route selection** (`selectRoute`): colour = hue within 18 deg (or the white/cream/grey family by brightness), chain links <= 24% of photo HEIGHT (vertical x0.6), seed from the brightest of stacked duplicate detections, duplicates dropped. Verified on Adam's portrait photo `~/Downloads/126.jpg`: any pink/white/yellow tap selects all 8.
- **Photos** fit inside the frame on every screen (`WallPhoto` with `aspect`, container queries), portrait and landscape.
- **Look**: palette white paper/surface `#FFFFFF`, ink `#243E36`, accent sage `#7CA982`, accent-ink `#3F7A55` (text), alert `#B5452F` (errors only), muted `#5A6E66`, hairline `#D2E2CB`. Fonts: Barlow family + Josefin Sans (wordmark, How it works). Route outlines white with dark edge; starts green, finish red. Top bar: "Ascend" wordmark (rock d) + mini route of hold icons Photo/Route/You/Beta, bolt holes ahead, solid rope behind.
- **Coach**: Live mic runs Zaki's `createCoach`; with no agent id it reads moves aloud with a "Next move" button.

## Testing method
No browser tool. Headless Chrome via `puppeteer-core` installed in a scratchpad dir (not the repo); Chrome at `/Applications/Google Chrome.app`; viewport 390x844 mobile; for the 3D viewer launch with `--use-angle=swiftshader --enable-unsafe-swiftshader`. The last session's scripts lived in the old scratchpad (`.../scratchpad/pt/`, e.g. `e2e.mjs` = full flow on wall-1 with 3D + strength re-solve, `every.mjs` = tap every hold on `~/Downloads/126.jpg`); recreate if the scratchpad is gone. Route holds are `[data-hold]` groups containing `path[stroke-width="3"]`. Old scripts that click `examples/thumb-example` are obsolete.

## Waiting on teammates (tell Adam)
- **Zaki**: ElevenLabs agent id for `frontend/.env.local` (`VITE_ELEVENLABS_AGENT_ID`); rename the agent from "BetaCrux coach" to Ascend (`coach/agent.config.json`); narrow the coach's height range to 1.40-2.10; `docs/demo_timestamps.json` for the filmed-climb demo (`createVideoProgress`, not wired yet).
- **Krishna**: trained detector `.pt` files on the demo laptop; his demo pages still say BetaCrux.

## Next steps / ideas
1. Demo readiness: backend + trained weights on the demo laptop; mic needs https or localhost (phone over LAN http falls back to read-aloud).
2. Filmed-climb demo mode with Zaki's `createVideoProgress` once timestamps exist.
3. Live mode pose tracking (PLAN A5) if time.
4. Figma evidence screenshots for Zaki's slides; frontend lines for the README (APIs/tools used).
