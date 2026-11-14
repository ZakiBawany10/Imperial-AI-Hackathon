import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoachTools, describeMove, describeRoute, directionWords, distanceWords, planCalls } from "./coachTools.js";
import { fixtureRequest, fixtureSolve, fixtureHoldTypes, fixtureMixedRequest, fixtureMixedSolve } from "./test_fixture.js";

const CONTRACT = join(dirname(fileURLToPath(import.meta.url)), "..", "contract");

function tools(extra = {}) {
  const state = { request: fixtureRequest, solve: fixtureSolve, holdTypes: fixtureHoldTypes };
  return createCoachTools({ getState: () => state, ...extra });
}

const call = async (fn, params) => JSON.parse(await fn(params));

test("direction and distance words", () => {
  assert.equal(directionWords(0, 100), "up");
  assert.equal(directionWords(-100, 5), "left");
  assert.equal(directionWords(80, 100), "up and right");
  assert.equal(directionWords(-80, -100), "down and left");
  assert.equal(distanceWords(0.527), "about 50 centimetres");
  assert.equal(distanceWords(0.03), "about 10 centimetres");
  assert.equal(distanceWords(1.02), "about a metre");
  assert.equal(distanceWords(1.26), "about 1.3 metres");
  assert.equal(distanceWords(1.98), "about 2 metres");
});

test("describeMove reads limb, direction, distance and hold type", () => {
  const m0 = describeMove(fixtureRequest, fixtureSolve, 0, fixtureHoldTypes);
  assert.equal(m0.say, "Right hand, up, about 50 centimetres, to the crimp.");
  assert.equal(m0.is_crux, false);

  const m1 = describeMove(fixtureRequest, fixtureSolve, 1, fixtureHoldTypes);
  assert.equal(m1.say, "Left hand, up, about 90 centimetres, to the sloper.");
  assert.equal(m1.is_crux, true);

  const m2 = describeMove(fixtureRequest, fixtureSolve, 2, fixtureHoldTypes);
  assert.equal(m2.say, "Right hand, up and right, about a metre, to the jug.");

  const m3 = describeMove(fixtureRequest, fixtureSolve, 3, fixtureHoldTypes);
  assert.equal(m3.is_match, true);
  assert.equal(m3.is_last_move, true);
  assert.equal(m3.say, "Left hand, match on the jug.");

  assert.equal(describeMove(fixtureRequest, fixtureSolve, 4), null);
});

test("describeRoute summarises grade, crux and moves", () => {
  const r = describeRoute(fixtureRequest, fixtureSolve, fixtureHoldTypes);
  assert.equal(r.grade, "Font 6a, which is V3");
  assert.equal(r.total_moves, 4);
  assert.equal(r.crux_move_number, 2);
  assert.equal(r.moves.length, 4);
});

test("get_next_move steps through the route and finishes", async () => {
  const steps = [];
  const { clientTools } = tools({ onStepChange: (s) => steps.push(s) });
  const next = clientTools.get_next_move;

  // Finishing a move that was never called does not advance.
  assert.equal((await call(next, { climber_finished_last_move: true })).move_number, 1);
  // Asking again repeats.
  assert.equal((await call(next, { climber_finished_last_move: false })).move_number, 1);
  assert.equal((await call(next, { climber_finished_last_move: true })).move_number, 2);
  assert.equal((await call(next, { climber_finished_last_move: true })).move_number, 3);
  assert.equal((await call(next, { climber_finished_last_move: true })).move_number, 4);
  assert.equal((await call(next, { climber_finished_last_move: true })).status, "finished");
  assert.equal((await call(next, { climber_finished_last_move: true, restart: true })).move_number, 1);
  assert.ok(steps.includes(3));
});

test("live mode progress overrides the coach's own counter", async () => {
  let done = 2;
  const { clientTools } = tools({ getProgress: () => done });
  assert.equal((await call(clientTools.get_next_move, { climber_finished_last_move: false })).move_number, 3);
  done = 4;
  assert.equal((await call(clientTools.get_next_move, { climber_finished_last_move: false })).status, "finished");
});

test("set_climber_height re-solves, reports change and resets", async () => {
  const state = { request: fixtureRequest, solve: fixtureSolve };
  const shorter = { ...fixtureSolve, moves: fixtureSolve.moves.slice(0, 3) };
  const coach = createCoachTools({
    getState: () => state,
    onHeightChange: async (h) => {
      state.request = { ...state.request, climber_height_m: h };
      state.solve = shorter;
    },
  });
  await call(coach.clientTools.get_next_move, { climber_finished_last_move: false });
  await call(coach.clientTools.get_next_move, { climber_finished_last_move: true });
  assert.equal(coach.getStep(), 1);

  const res = await call(coach.clientTools.set_climber_height, { height_m: 1.55 });
  assert.equal(res.sequence_changed, true);
  assert.equal(res.climber_height_m, 1.55);
  assert.equal(res.total_moves, 3);
  assert.equal(coach.getStep(), 0);

  assert.ok((await call(coach.clientTools.set_climber_height, { height_m: 175 })).error);
});

test("tools return an error, not a crash, before a route is solved", async () => {
  const { clientTools } = createCoachTools({ getState: () => ({}) });
  assert.ok((await call(clientTools.get_route)).error);
  assert.ok((await call(clientTools.get_next_move, { climber_finished_last_move: false })).error);
  assert.ok((await call(clientTools.set_climber_height, { height_m: 1.7 })).error);
});

test("tools.json matches the handlers", () => {
  const defs = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
  const { clientTools } = tools();
  assert.deepEqual(defs.map((d) => d.name).sort(), Object.keys(clientTools).sort());
  for (const d of defs) assert.equal(d.type, "client");
});

// Same route with foot moves: LF up, RH, RF up + LF up, LH (crux), then a trailing RF.
// Moves 0..6 -> keyframes 0..7. Feet start at lf [580,1400], rf [660,1400].
const footSolve = (() => {
  const P = (lh, rh, lf, rf) => ({ lh, rh, lf, rf });
  const kf = [
    P([540, 1100], [700, 1080], [580, 1400], [660, 1400]),
    P([540, 1100], [700, 1080], [590, 1250], [660, 1400]), // after LF up
    P([540, 1100], [760, 900], [590, 1250], [660, 1400]), //  after RH
    P([540, 1100], [760, 900], [590, 1250], [680, 1230]), //  after RF up
    P([540, 1100], [760, 900], [600, 1100], [680, 1230]), //  after LF up
    P([560, 760], [760, 900], [600, 1100], [680, 1230]), //   after LH (crux)
    P([560, 760], [760, 900], [600, 1100], [700, 1050]), //   after trailing RF
  ];
  return {
    grade: fixtureSolve.grade,
    crux: 4,
    moves: [
      { i: 0, limb: "LF", hold: 40 },
      { i: 1, limb: "RH", hold: 12 },
      { i: 2, limb: "RF", hold: 41 },
      { i: 3, limb: "LF", hold: 42 },
      { i: 4, limb: "LH", hold: 15 },
      { i: 5, limb: "RF", hold: 43 },
    ],
    keyframes: kf.map((joints, move) => ({ move, joints })),
  };
})();
const footRequest = {
  ...fixtureRequest,
  holds: [
    ...fixtureRequest.holds,
    ...[40, 41, 42, 43].map((id) => ({ id, x: 0, y: 0, w: 20, h: 20, type: "foot", quality: 0.2 })),
  ],
};

test("planCalls merges, skips or calls foot moves", () => {
  assert.deepEqual(planCalls(footSolve, "merge").map((c) => c.moves), [[0, 1], [2, 3, 4], [5]]);
  assert.deepEqual(planCalls(footSolve, "skip").map((c) => c.moves), [[1], [4]]);
  assert.deepEqual(planCalls(footSolve, "call").length, 6);
  // A route with no foot moves is unchanged in every mode.
  for (const mode of ["merge", "skip", "call"]) assert.equal(planCalls(fixtureSolve, mode).length, 4);
});

test("merged calls lead in with the feet, then the hand move", () => {
  const state = { request: footRequest, solve: footSolve };
  const route = describeRoute(state.request, state.solve, null, "merge");
  assert.deepEqual(route.moves, [
    "Left foot up, then right hand, up, about 50 centimetres, to the crimp.",
    "Feet up, then left hand, up, about 90 centimetres, to the sloper.",
    "Right foot, up, about 50 centimetres, to the foothold.",
  ]);
  assert.equal(route.total_moves, 3);
  assert.equal(route.crux_move_number, 2);
});

test("footMoves is merge by default; skip calls hands only", async () => {
  const state = { request: footRequest, solve: footSolve };
  const merged = createCoachTools({ getState: () => state });
  const first = await call(merged.clientTools.get_next_move, { climber_finished_last_move: false });
  assert.match(first.say, /^Left foot up, then right hand/);
  assert.deepEqual(first.move_indices, [0, 1]);

  const skip = createCoachTools({ getState: () => state, footMoves: "skip" });
  const s1 = await call(skip.clientTools.get_next_move, { climber_finished_last_move: false });
  const s2 = await call(skip.clientTools.get_next_move, { climber_finished_last_move: true });
  const s3 = await call(skip.clientTools.get_next_move, { climber_finished_last_move: true });
  assert.equal(s1.say, "Right hand, up, about 50 centimetres, to the crimp.");
  assert.equal(s2.is_crux, true);
  assert.equal(s3.status, "finished");

  assert.throws(() => createCoachTools({ getState: () => state, footMoves: "loud" }));
});

test("progress and step hooks use move indices, not call numbers", async () => {
  const state = { request: footRequest, solve: footSolve };
  let done = 0;
  const seen = [];
  const coach = createCoachTools({ getState: () => state, getProgress: () => done, onStepChange: (i) => seen.push(i) });
  const next = () => call(coach.clientTools.get_next_move, { climber_finished_last_move: false });

  assert.equal((await next()).move_number, 1);
  done = 1; // only the foot move of call 1 is done: still call 1
  assert.equal((await next()).move_number, 1);
  done = 2;
  assert.equal((await next()).move_number, 2);
  done = 6;
  assert.equal((await next()).status, "finished");
  assert.deepEqual(seen, [0, 2, 6]);
});

test("mixed hand and foot moves read naturally in the default merge mode", () => {
  const route = describeRoute(fixtureMixedRequest, fixtureMixedSolve, fixtureHoldTypes);
  assert.deepEqual(route.moves, [
    "Right foot up, then right hand, up, about 50 centimetres, to the crimp.",
    "Feet up, then left hand, up, about 90 centimetres, to the sloper.",
    "Feet up, then right hand, up and right, about a metre, to the jug.",
    "Left hand, match on the jug.",
  ]);
  assert.equal(route.crux_move_number, 2);
});

test("a foot whose hold isn't in the request doesn't crash or claim a hold", () => {
  // Move 3: hold null. Move 5: hold id 99 not in the request. Move 6: no hold key.
  for (const i of [3, 5, 6]) {
    const m = describeMove(fixtureMixedRequest, fixtureMixedSolve, i, fixtureHoldTypes);
    assert.equal(m.on_route_hold, false);
    assert.equal(m.hold_type, null);
    assert.equal(m.is_match, false);
    assert.doesNotMatch(m.say, /to the|undefined|null/);
  }
  assert.equal(describeMove(fixtureMixedRequest, fixtureMixedSolve, 3).say, "Right foot, up, about 40 centimetres.");

  // With no keyframes either, it still says something sensible.
  const bare = { ...fixtureMixedSolve, keyframes: [] };
  assert.equal(describeMove(fixtureMixedRequest, bare, 6).say, "Move your right foot.");
  // Two wall feet in a row must not count as a "match".
  const twoWall = { ...fixtureMixedSolve, moves: [{ i: 0, limb: "LF", hold: null }, { i: 1, limb: "RF", hold: null }] };
  assert.equal(describeMove(fixtureMixedRequest, twoWall, 1).is_match, false);
});

test("stepping through the mixed route in every mode ends cleanly", async () => {
  const state = { request: fixtureMixedRequest, solve: fixtureMixedSolve, holdTypes: fixtureHoldTypes };
  for (const [mode, calls] of [["merge", 4], ["skip", 4], ["call", 9]]) {
    const coach = createCoachTools({ getState: () => state, footMoves: mode });
    const says = [];
    let r = await call(coach.clientTools.get_next_move, { climber_finished_last_move: false });
    while (!r.status) {
      says.push(r.say);
      r = await call(coach.clientTools.get_next_move, { climber_finished_last_move: true });
    }
    assert.equal(says.length, calls, mode);
    assert.equal(r.status, "finished");
  }
});

test("works on the real contract examples when they exist", { skip: !existsSync(join(CONTRACT, "solve.json")) }, async () => {
  const solve = JSON.parse(readFileSync(join(CONTRACT, "solve.json"), "utf8"));
  const analyze = existsSync(join(CONTRACT, "analyze.json"))
    ? JSON.parse(readFileSync(join(CONTRACT, "analyze.json"), "utf8"))
    : { image: { w: 1920, h: 1440 }, holds: [] };
  const request = { image: analyze.image, holds: analyze.holds, climber_height_m: 1.75, wall_height_m: 4.0 };
  const r = describeRoute(request, solve);
  assert.equal(r.total_moves, solve.moves.length);
  for (const say of r.moves) assert.match(say, /^((Left|Right) (hand|foot)|Feet|Adjust your feet|Move your)/);
  for (const say of r.moves) assert.doesNotMatch(say, /undefined|null|NaN/);
});
