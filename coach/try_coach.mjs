// Text-only rehearsal of the coach tools. No network, no API key.
//
//   node try_coach.mjs
//
// Uses contract/solve.json and contract/solve_request.json if they exist, otherwise
// the test fixture. Type a command at the prompt:
//   enter / next   climber finished the move, give the next one
//   again          repeat the current move
//   route          the whole route
//   height 1.55    change height (only re-labels here; the real app re-solves)
//   restart, quit
//
//   node try_coach.mjs --mixed                 test route with foot moves (default merge mode)
//   node try_coach.mjs --mixed --feet=call     or --feet=skip
//   node try_coach.mjs --live=http://127.0.0.1:8001
//                         POST contract/solve_request.json to a running backend
//                         and coach from its live /solve answer (with foot moves)

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoachTools } from "./coachTools.js";
import { fixtureRequest, fixtureSolve, fixtureHoldTypes, fixtureMixedRequest, fixtureMixedSolve } from "./test_fixture.js";

const CONTRACT = join(dirname(fileURLToPath(import.meta.url)), "..", "contract");
const read = (f) => JSON.parse(readFileSync(join(CONTRACT, f), "utf8"));

const MIXED = process.argv.includes("--mixed");
const FEET = (process.argv.find((a) => a.startsWith("--feet=")) || "--feet=merge").slice(7);
const LIVE = (process.argv.find((a) => a.startsWith("--live=")) || "").slice(7).replace(/\/$/, "");

let state;
if (LIVE) {
  const request = read("solve_request.json");
  const r = await fetch(`${LIVE}/solve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!r.ok) throw new Error(`POST ${LIVE}/solve returned ${r.status}: ${await r.text()}`);
  const solve = await r.json();
  const holdTypes = existsSync(join(CONTRACT, "hold_types.json")) ? read("hold_types.json") : undefined;
  state = { request, solve, holdTypes };
  console.log(`Using the live /solve answer from ${LIVE} for contract/solve_request.json, footMoves: ${FEET}.`);
  console.log(`Moves: ${solve.moves.map((m) => `${m.limb}->${m.hold}`).join(", ")}; crux index ${solve.crux}.`);
} else if (MIXED) {
  state = { request: fixtureMixedRequest, solve: fixtureMixedSolve, holdTypes: fixtureHoldTypes };
  console.log(`Using the mixed hand/foot test route, footMoves: ${FEET}.`);
} else if (existsSync(join(CONTRACT, "solve.json")) && existsSync(join(CONTRACT, "solve_request.json"))) {
  state = {
    request: read("solve_request.json"),
    solve: read("solve.json"),
    holdTypes: existsSync(join(CONTRACT, "hold_types.json")) ? read("hold_types.json") : undefined,
  };
  console.log("Using contract/solve_request.json and contract/solve.json.");
} else {
  state = { request: fixtureRequest, solve: fixtureSolve, holdTypes: fixtureHoldTypes };
  console.log("Contract files not found; using the test fixture.");
}

const { clientTools } = createCoachTools({
  footMoves: FEET,
  getState: () => state,
  onHeightChange: async (h) => {
    state = { ...state, request: { ...state.request, climber_height_m: h } };
  },
});

const show = (json) => {
  const o = JSON.parse(json);
  console.log(o.say ? `coach: ${o.say}${o.is_crux ? "  [crux]" : ""}` : JSON.stringify(o, null, 2));
};

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
show(await clientTools.get_next_move({ climber_finished_last_move: false }));
rl.prompt();
for await (const raw of rl) {
  const line = raw.trim().toLowerCase();
  if (line === "quit" || line === "q") break;
  if (line === "" || line === "next") show(await clientTools.get_next_move({ climber_finished_last_move: true }));
  else if (line === "again") show(await clientTools.get_next_move({ climber_finished_last_move: false }));
  else if (line === "restart") show(await clientTools.get_next_move({ climber_finished_last_move: false, restart: true }));
  else if (line === "route") show(await clientTools.get_route());
  else if (line.startsWith("height")) show(await clientTools.set_climber_height({ height_m: Number(line.split(/\s+/)[1]) }));
  else console.log("commands: enter/next, again, route, height <m>, restart, quit");
  rl.prompt();
}
rl.close();
