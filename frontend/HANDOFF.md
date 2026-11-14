# Frontend handoff (Adam, BetaCrux)

Read this first, then `../CLAUDE.md` (repo rules) and `../Documents/PLAN.md` (plan + API contract).
Last updated: Sat 14 Nov 2026, after A2 + PWA + font change.

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
- `src/lib/wall.ts` = original MOCK wall/beta data (1000x1000 space). Route + Play still run on this mock.
- `src/lib/contract.ts` = adapter from the real contract (`@contract` alias -> `../contract`, allowed in `vite.config.ts` `server.fs.allow`). `prepare(photo, analyze)` converts photo pixels to a 1000-wide overlay space (1 px = 1000/image.w), groups holds into colour groups by hue (detector gives every hold its own hex, 178 distinct), and returns holds, unsure ids, aspect.
- **A2 done**: Review shows the 178 real holds over `contract/wall.jpg`. Tap = select colour group; start/finish; "?" badges and confirm sheet appear only for holds on the chosen route (PLAN step 3); close-up + real top-3 suggestions.
- **PWA done**: `public/manifest.webmanifest`, `public/sw.js` (app shell offline; never caches /analyze /solve /hold-types /demo), icons (192/512/maskable/apple-touch, generated custom), meta tags in `index.html`. SW registers in production builds only. Verified: no installability errors, loads offline.
- Fonts: Barlow Condensed (display), Barlow (body), Barlow Semi Condensed caps (the `MONO` class labels). Chosen because the previous fonts looked "vibecoded". Wired in `src/index.css` only.
- Design tokens: paper #F4EFE6, surface #FBF8F2, ink #1B1A17, muted #6B665C, hairline #D9D2C3, accent #E8431F, tape blue #2F6FDE / yellow #E8B100 / green #2E8B57. Light mode only, 4px card radius, 6px buttons, no gradients/blur/emoji.

## Decisions and gotchas
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
1. **A3** Review -> Route -> real `POST /solve`: build the body from the confirmed route holds (set `type`, copy `quality` from `GET /hold-types`, `needs_review=false`), `start`/`finish` ids as NUMBERS (the contract ids are ints; my overlay ids are `h<id>`), `climber_height_m`, `wall_height_m`, `wall_angle_deg`. Fixtures: `contract/solve_request.json`, `contract/solve.json`. Backend lives in `backend/` (see its README for running it; `/demo/` test page exists). Replace the mock beta in Route/Play.
2. **A3b** already largely covered by the confirm sheet; add the full list from `/hold-types` (currently hard-coded `HOLD_TYPES` in `wall.ts`, PLAN says never hard-code).
3. **A4** Play: animate the real `keyframes` with smooth interpolation, crux highlight, grade card from `grade` (`font`, `v`, `low`, `high`).
4. **A5** Live mode with in-browser pose tracking; **A6** voice coach via Zaki's agent in `coach/`.
5. Hook up real `/analyze` for uploaded photos.
6. Figma evidence screenshots for Zaki's slides; send Zaki the Figma link.
7. Tell Zaki the README lines for the frontend (APIs/tools used).

## Open questions for Adam
- Swap the tape in the confirm-sheet close-up for hold pins too?
- Fill the screen vs show the whole landscape photo on Review?
