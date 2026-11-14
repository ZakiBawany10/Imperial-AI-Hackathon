# Frontend handoff (Adam, BetaCrux)

Read this first, then `../CLAUDE.md` (repo rules) and `../Documents/PLAN.md` (plan + API contract).
Last updated: Sat 14 Nov 2026, after linking every ready backend piece (analyze, hold-types, solve physics, voice coach).

## Who and where
- Working for **Adam**. Only write inside `frontend/`. `git config user.name` is set (repo-local) to "Adam Wilkinson"; check it before editing.
- Repo: `~/imperial-ai-hackathon` (public GitHub, everyone pushes to `main`).
- Git: `git add frontend/` only. `git pull --rebase` before every push. Never force-push. No `.env` or keys.
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Other folders are read-only: `contract/`, `backend/` (Krishna); `coach/`, `adaption/`, `docs/`, root README (Zaki). If the contract looks wrong, tell Adam what to ask Krishna; do not code around it.

## Run it
```
cd ~/imperial-ai-hackathon/frontend
npx pnpm@10 install            # pnpm is not installed globally
PORT=5173 FIGMA_DEV_SERVER_HOST=localhost npx pnpm@10 run dev
npx tsc --noEmit               # typecheck
npx pnpm@10 run build && PORT=4173 FIGMA_DEV_SERVER_HOST=localhost npx pnpm@10 run preview   # PWA/service worker only work in the built app
```
Make's default binds 0.0.0.0:8443; I bind to localhost on purpose.

## What exists
React 19 + Vite 8 + Tailwind v4 + TypeScript. Exported from Figma Make ("Design BetaCrux Upload Screen"), then extended.
- Screens in `src/screens/`: Upload, Review, Route, Play (Play includes Live mode). `src/App.tsx` has `Flow` (real flow), `Board` (all design frames side by side, desktop), and picks phone layout at `max-width:520px` or coarse pointer up to 1024px.
- `src/ui/kit.tsx` shared UI (Screen, TopBar, BottomSheet, WallPhoto, HoldShape...). `src/ui/HoldPins.tsx` custom bolted-hold illustrations pinning the upload sheet.
- `src/lib/wall.ts` = original MOCK wall/beta data (1000x1000 space). Only the Board frames use it now.
- `src/lib/api.ts` = API client. Base URL `VITE_API_URL`, else `http://<page host>:8010`. `solve()`, `loadHoldTypes()`/`qualityOf()` (GET /hold-types, falls back to the contract list), `EXAMPLE_SOLVE` (contract fixture pair). `ApiError.offline` = server unreachable.
- `src/lib/beta.ts` = `BetaView`, the one shape Route/Play/Live draw: moves (limb, target hold or null, label, text), crux (1-based), grade, route/others holds, aspect, `poseAt(t)` (eased keyframe interpolation). `realBeta(res, ...)` from /solve, `mockBeta(height, ...)` for the Board.
- `src/lib/contract.ts` = adapter from the real contract (`@contract` alias -> `../contract`, allowed in `vite.config.ts` `server.fs.allow`). `prepare(photo, analyze)` converts photo pixels to a 1000-wide overlay space (1 px = 1000/image.w), groups holds into colour groups by hue (detector gives every hold its own hex, 178 distinct), and returns holds, unsure ids, aspect.
- **A2 done**: Review shows the 178 real holds over `contract/wall.jpg`. Tap = select colour group; start/finish; "?" badges and confirm sheet appear only for holds on the chosen route (PLAN step 3); close-up + real top-3 suggestions.
- **PWA done**: `public/manifest.webmanifest`, `public/sw.js` (app shell offline; never caches /analyze /solve /hold-types /demo), icons (192/512/maskable/apple-touch, generated custom), meta tags in `index.html`. SW registers in production builds only. Verified: no installability errors, loads offline.
- Fonts: Barlow Condensed (display), Barlow (body), Barlow Semi Condensed caps (the `MONO` class labels). Chosen because the previous fonts looked "vibecoded". Wired in `src/index.css` only.
- Design tokens: paper #F4EFE6, surface #FBF8F2, ink #1B1A17, muted #6B665C, hairline #D9D2C3, accent #E8431F, tape blue #2F6FDE / yellow #E8B100 / green #2E8B57. Light mode only, 4px card radius, 6px buttons, no gradients/blur/emoji.

- **A3 done**: Review `onNext(pick)` -> Route (real route holds over the real photo) -> `buildSolve()` in `contract.ts` makes the body (contract int ids, confirmed type + quality from hold DB, needs_review=false; user-added holds get new ids) -> `POST /solve` -> Play/Live draw the real keyframes and grade. Solving screen waits at least 1.2 s so the trace reads. Errors (422 message etc.) show on the solving screen with Back; if the server is unreachable there is also "Use example" (contract solve fixture, yellow "Example answer" badge). Play height slider re-solves (300 ms debounce, old beta stays up).
- Tested headless against the real backend (venv in a scratchpad, not in backend/): yellow route 1.75 m -> 6a, 10 moves; 1.55 m -> 6b, 11 moves. Offline path and Board frames also checked.

- **Backend linked** (all of it that is ready):
  - `/analyze`: Upload sends the photo (shrunk to 2048 px, EXIF-upright, `shrinkPhoto` in api.ts) and pins the real holds when it answers; Review/Route/Play then use that wall (`wall` in Flow). Server down or no holds -> error + "Use the example wall". The example thumbnail is `contract/wall.jpg` (no request).
  - `/hold-types`: "Other..." list (name, description, server SVG picture, sketch fallback offline); `unknown` is pickable ("Not sure"). Quality for /solve from the same list.
  - `/solve` physics: per-move `fall_chance` and `physics.finish_chance` shown under the move text on Play.
  - Coach: Play's move text is Zaki's `describeMove().say` (`@coach` alias -> `../coach`, read-only, typed in `src/coach.d.ts`). Live's mic button starts the ElevenLabs agent (`src/lib/coach.ts`, `@elevenlabs/client` pinned 1.32.1, loaded on first use) with `createCoachTools` reading the current request/answer; "set my height" re-solves; the coached move drives Live's move. Needs `VITE_ELEVENLABS_AGENT_ID` in `frontend/.env.local` (from Zaki; never commit). Mic needs https or localhost, so on a phone over LAN http it won't get the mic.
  - Route selection (real data): `selectRoute` in contract.ts: holds within 14 deg hue of the tapped one, chained at <= 19% photo width (vertical gaps x0.6), duplicate detections dropped. Yellow example: 25 holds/14 questions -> 12/5.
- **Example walls**: contract wall (instant, offline) + two Seattle walls in `public/examples/` (CC BY-SA 4.0, Joe Mabel; credit shown under the thumbnails, `CREDITS.txt`). A Seattle tap goes through `/analyze`, unless `public/examples/<name>.analyze.json` exists: then that saved answer is used (instant, offline). Ask Krishna to run his trained detector on both photos and send the two JSONs.
- Not linked (deliberately): `/depth` (relief map, used by Krishna's 3D page; nothing in our screens needs it), keyframe `contacts`/`physics.forces` (could draw force arrows in Play later).

## Decisions and gotchas
- Backend: a foot move can come back with `fall_chance` 0.999 (effort 2.2, unstable) inside the "safest" sequence, so `finish_chance` collapses to 0.1% (seen on the 12-hold yellow selection; the contract's 7-hold route gives 96%). Reported to Krishna via Adam.
- Untested end to end: real `/analyze` (the trained weights aren't in git, and the zero-shot fallback downloads ~900 MB), and a live ElevenLabs session (no agent id here). Both tested up to the call: analyze with a stubbed response, coach up to the "not set up" message.
- Live backend returns things the contract does not describe yet (reported to Krishna via Adam): foot moves (`LF`/`RF`), extra move fields `effort`/`stable`/`fall_chance`, top-level `physics` (with `finish_chance`), keyframe `contacts`/`physics`, and `"hold": null` for a foot smearing on the wall. Frontend tolerates all of it.
- Make's own `CLAUDE.md`, `AGENTS.md` and `.gitattributes` were deliberately NOT copied. `.gitattributes` sent all images to Git LFS (breaks teammates); Make's CLAUDE.md would overwrite the repo's rules and says a dev server is already running.
- `.figma/` is kept (Make wants it for re-import).
- Uploaded photos currently still show the example wall's holds (Flow always uses `EXAMPLE_WALL`). Wiring to the real `/analyze` is not done.
- Contract hold type `unknown` is not in the screens' type list: adapter maps it to `jug` and flags it for review.
- Photo is landscape in a portrait view: `WallPhoto` has an `aspect` prop that shows the whole photo (dark bands above/below, pinch to zoom). Ask Adam if he wants it to fill instead.
- Hold `x,y` in the contract are hold CENTRES; `w,h` full box. Keyframe k = pose after moves[k-1]; one more keyframe than moves (see `../contract/README.md`).
- Board frames (design evidence) still use mock data; keep them that way.
- Figma Make history is Adam's evidence for the Figma prize; the round-trip import back to Figma is optional and must be described honestly (designed in Make, built in code, imported back to check parity).

## Testing method
No browser tool in the session. I used Chrome headless via `puppeteer-core` (installed in a scratchpad dir, not in the repo): viewport 390x844, `isMobile`, `hasTouch`, screenshots + DOM checks (`[data-hold]` count, `data-name` attributes). Chrome is at `/Applications/Google Chrome.app`. Recreate in a scratch dir outside the repo if needed.

## Next steps (PLAN.md)
1. Get the agent id from Zaki into `.env.local` and try the coach on a laptop (localhost). For the phone demo, serve over https (e.g. `vite --https` with a local cert) or the mic is blocked.
2. Route selection still over-selects a little (12 vs the real 7 on the example): let tapping a selected, confirmed hold remove it from the route.
3. **A4** mostly done by A3 (eased keyframe interpolation, crux, real grade card). Left: colour moves by `load`, nicer crux highlight on the photo.
4. **A5** Live mode with in-browser pose tracking; **A6** voice coach via Zaki's agent in `coach/`.
6. Figma evidence screenshots for Zaki's slides; send Zaki the Figma link.
7. Tell Zaki the README lines for the frontend (APIs/tools used).

## Open questions for Adam
- Swap the tape in the confirm-sheet close-up for hold pins too?
- Fill the screen vs show the whole landscape photo on Review?
