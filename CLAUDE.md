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
