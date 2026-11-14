# Status: Zaki's lane

Saturday 14 November, 18:00. Written by Zaki's agent while Zaki was away.

## Finished

All six tasks are done and pushed to `main`. Only `coach/`, `adaption/` and
`docs/` were touched. No ElevenLabs or Adaption API was called.

1. **Setup script saves ids as it goes.** `coach/setup_agent.mjs` writes
   `agent_ids.json` after every successful create or update. If `--apply` fails
   halfway, re-running updates what exists instead of creating duplicate tools.
   Four tests use a fake API, including a failure on the third request followed
   by a re-run. The dry run still prints all four requests and writes nothing.
2. **Agent id kept off GitHub.** `coach/.gitignore` ignores `agent_ids.json`.
   The coach README says Adam gets the id from you directly.
3. **Foot moves.** New `footMoves` option in `coach/coachTools.js`. The default,
   `"merge"`, folds foot moves into the next hand move: "Feet up, then right
   hand, up, about 50 centimetres, to the crimp." `"skip"` calls hand moves only;
   `"call"` calls every move. Live-mode progress and the step hook still use
   move indices, so Adam's side doesn't change. This also fixed a bug where the
   step hook fired twice per advance.
4. **Team messages.** `docs/messages_for_team.md` has one for Krishna and one
   for Adam (wiring the coach, agent id to follow, demo-mode `getProgress` from
   video timestamps). Krishna pushed his backend while I worked, and his code
   answers all four contract questions:
   - `crux` indexes `moves`.
   - Hold `x`, `y` is the box centre.
   - Image left is the climber's left.
   - `/solve` returns hand moves only.

   So his message is now a short confirmation plus two asks: commit the
   `contract/` example files, and say where the Kilter data is.
5. **Adaption dataset (prep only).** `adaption/build_dataset.py` turns 30,642
   MoonBoard 2016 problems into 22,236 training and 2,841 test rows of
   "description → Font grade". Setter names, cities, profile pictures and
   problem URLs are dropped, and a test checks for leaks. The test split includes
   all 367 benchmarks. Guessing the median grade misses by 1.84 grade steps,
   which is the number to beat. The README lists what I confirmed in Adaption's
   docs versus what I assumed.
6. **Committed and pushed** as one commit after checking `git status` and
   running `git pull --rebase`. It rebased cleanly onto Krishna's four backend
   commits, and all tests still passed. This status file goes in a second small
   commit.

Tests: coach 16 pass, 1 skipped (it runs once `contract/solve.json` exists);
adaption 5 pass.

## What failed or is blocked

- **ElevenLabs:** paused as instructed. The agent doesn't exist yet.
- **The contract-example test is still skipped.** Krishna hasn't committed
  `contract/solve.json` or `analyze.json`. Nothing has been tested against real
  `/solve` output yet, only against code reading and test data.
- **Adaption details I couldn't find in their docs:** run time, credit cost,
  and how to score the result. They give a downloadable checkpoint and a "win
  rate", not a hosted model, so measuring grade error on our test split needs
  somewhere to run it. Worth asking at their table.
- **Pickle safety:** the MoonBoard file is a Python pickle, which can run code
  when loaded. I checked its contents without loading it (no class imports), and
  the builder loads it with all class imports blocked. No issue found.
- **Pull with rebase:** blocked once by my own uncommitted changes. Resolved by
  committing first, as the rules require.

## Decisions waiting for you

1. **Foot-move default:** I chose `"merge"` over `"skip"`. It's one word in
   Adam's setup if you prefer skip. It doesn't matter until `/solve` returns foot
   moves.
2. **Adaption model:** pick one, or let AutoScientist choose. Our 22k rows clear
   every model's minimum, including the 10k-row large models. A small model such
   as Qwen 3.5 0.8B or Llama 3.2 3B is likely quickest, but run time isn't
   documented.
3. **Training data filter:** I dropped problems nobody repeated (5,525), since
   their grade is only the setter's opinion. Re-run with `--min-repeats 0` to
   keep them, or raise it for cleaner but fewer rows.
4. **Send the team messages:** both are ready to paste from
   `docs/messages_for_team.md`.
5. **Agent auth:** the agent is planned as public (no token server). Anyone with
   the id could spend your ElevenLabs credits. That's fine for the weekend while
   the id stays out of the repo.

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
