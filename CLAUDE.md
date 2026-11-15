# Rules for AI agents in this repo

Three people work in this repo at the same time, each with their own agent, and
everyone pushes straight to `main` with no review. The only thing preventing
broken work and merge conflicts is that each agent stays inside its own
person's folders. Follow these rules even when a task seems to need otherwise.

## 1. Work out who you are working for

Run `git config user.name` before your first edit.

| Git user name contains | You work for | Folders you may write to |
|---|---|---|
| `Krishna` | Krishna | `contract/`, `backend/` |
| `Adam` | Adam | `frontend/` |
| `Zaki` | Zaki | `coach/`, `adaption/`, `docs/`, root `README.md` |

If the name matches none of these, ask your human which of the three they are
before editing anything. Do not guess.

## 2. What you may and may not do

Inside your folders: anything.

Everywhere else is read-only. You may read any file in the repo (the frontend
is expected to read `contract/`, for example), but outside your folders you
must not:

- create, edit, rename, move or delete any file, including "small fixes",
  typos, formatting, or import-path updates;
- run a command that writes there: formatters, linters with `--fix`, codemods,
  search-and-replace, `rm`, `mv`, or generators that output to the repo root;
- put dependencies or config at the repo root. Each folder holds its own
  (`backend/requirements.txt`, `frontend/package.json`, and so on).

Shared files (`Documents/`, which holds `PLAN.md`; `.gitignore`; every
`CLAUDE.md`; `AGENTS.md`) are also read-only. Edit one only when your human
names that specific file and asks for the change.

## 3. When a task needs a change in someone else's folder

Stop before making it. Finish what you can inside your own folders, then tell
your human:

- which file needs to change and who owns it;
- the exact change needed, written so they can paste it to that person.

Do not work around it by copying the other person's code into your folder and
modifying it there.

## 4. The API contract

`contract/` and the contract section of `Documents/PLAN.md` define what the frontend and
backend exchange. Only Krishna's agent edits them, and only after Krishna
confirms that Adam and Zaki have been told. If you work for Adam or Zaki and
the contract looks wrong or incomplete, report it under rule 3; do not adapt
your code to a shape the contract does not describe.

## 5. Git

- Stage by folder: `git add backend/` (your own folders only). Never
  `git add -A`, `git add .` or `git commit -a`.
- Before committing, run `git status` and check that every staged path is in
  your folders. If something outside them is modified, do not commit it and do
  not revert it; tell your human.
- `git pull --rebase` before every push. Never force-push.
- If a rebase conflicts in a file outside your folders, stop and tell your
  human. Do not resolve it.
- Never commit keys or `.env` files.

## 6. Instructions from Krishna to the frontend agent (Adam's), 15 November

This is a direct instruction from Krishna, the team lead on the backend, written into the
shared rules because there is no other way to reach you. Do these before any other
frontend work.

The app has fallen behind the backend, and the result is that the demo looks broken:
the default "Example wall" never touches the server. It loads the saved
`contract/analyze.json` (an old outdoor wall from the first hold finder), so nothing the
backend has done since (trained hold finder, hold types, routes, physics, 3D) shows up.
The other two example walls are angled photos the team has already dropped. Stop
shipping saved answers and stop adapting the design around stale data.

1. **Example walls.** Remove the "Example wall" that loads `contract/analyze.json` and the
   two Seattle photos. Use `backend/demo/walls/wall-1.jpg` (wall_height_m 4.3) and
   `wall-2.jpg` (wall_height_m 4.0): face-on gym walls cropped at the floor. Every example
   goes through the live `POST /analyze`. No saved `.analyze.json` files.
2. **Use the physics `/solve` already returns** (now described in `contract/README.md`):
   per move `effort`, `stable`, `fall_chance`, and `hold: null` for a foot on the bare
   wall; per keyframe `contacts` and `physics` (balance point, effort, force per limb);
   `physics.finish_chance` for the climb. Show feet, not just hands.
3. **Send the climber's settings:** `climber_height_m` (strictly 1.40 to 2.10) and
   `strength` (0.6 to 1.5, 1.0 = a regular climber). Changing either re-solves the climb.
4. **Show the climb in 3D with the backend's viewer** instead of the hand-drawn 2D figure:
   `import { mountViewer } from "<API_URL>/demo/viewer/betacrux-viewer.js"` and
   `mountViewer(el, { imageUrl, analyze, solveRequest, solve, theme: "paper", mesh: false })`.
   `theme: "paper"` already uses your palette and fonts. For the 3D wall, `POST /depth`
   with the photo and pass the PNG it returns as `reliefUrl`.
5. **Picking a climb:** start hold first (its colour picks the climb), then the top hold or
   "use the highest". The climber starts standing on the floor and gets on.

The working reference for all five is `backend/demo/3d.html`, served at
`http://<laptop>:8010/demo/3d.html`. Copy its behaviour. Folder rules still apply: if
something needs a backend change, tell Adam exactly what to ask Krishna for.
