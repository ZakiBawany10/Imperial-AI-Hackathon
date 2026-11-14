// Text-only rehearsal of the coach tools. No network, no API key.
//
//   node try_coach.mjs
//
// Uses contract/solve.json and contract/analyze.json if they exist, otherwise
// the test fixture. Type a command at the prompt:
//   enter / next   climber finished the move, give the next one
//   again          repeat the current move
//   route          the whole route
//   height 1.55    change height (only re-labels here; the real app re-solves)
//   restart, quit

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoachTools } from "./coachTools.js";
import { fixtureRequest, fixtureSolve, fixtureHoldTypes } from "./test_fixture.js";

const CONTRACT = join(dirname(fileURLToPath(import.meta.url)), "..", "contract");
const read = (f) => JSON.parse(readFileSync(join(CONTRACT, f), "utf8"));

let state;
if (existsSync(join(CONTRACT, "solve.json")) && existsSync(join(CONTRACT, "analyze.json"))) {
  const analyze = read("analyze.json");
  state = {
    request: { image: analyze.image, holds: analyze.holds, climber_height_m: 1.75, wall_height_m: 4.0 },
    solve: read("solve.json"),
  };
  console.log("Using contract/solve.json and contract/analyze.json (wall height assumed 4.0 m).");
} else {
  state = { request: fixtureRequest, solve: fixtureSolve, holdTypes: fixtureHoldTypes };
  console.log("Contract files not found; using the test fixture.");
}

const { clientTools } = createCoachTools({
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
