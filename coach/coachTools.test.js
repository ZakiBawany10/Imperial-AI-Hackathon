import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { colourName, createCoachTools, describeMove, describeRoute, directionWords, distanceWords, planCalls, reachWords } from "./coachTools.js";
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

test("reach size and colour words", () => {
  assert.equal(reachWords(0.1), "short reach");
  assert.equal(reachWords(0.3), "reach");
  assert.equal(reachWords(0.5), "long reach");
  assert.equal(reachWords(0.7), "big move");
  assert.equal(reachWords(0.9), "jump for it");
  assert.equal(colourName("#2050c0"), "blue");
  assert.equal(colourName("#efda4e"), "yellow");
  assert.equal(colourName("#d02020"), "red");
  assert.equal(colourName("#f4f4f4"), "white");
  assert.equal(colourName("nope"), null);
});

test("describeMove talks like a coach: reach, body position, hold, landmark", () => {
  const m0 = describeMove(fixtureRequest, fixtureSolve, 0, fixtureHoldTypes);
  assert.equal(m0.say, "Reach, right hand to the next little crimp up, out to your right at head height.");
  assert.equal(m0.reach, "reach");
  assert.equal(m0.hold_description, "little crimp");
  assert.equal(m0.how_far, "about 50 centimetres"); // only for "how far?"
  assert.equal(m0.is_crux, false);
  assert.ok(m0.phrasings.length >= 2 && m0.phrasings.length <= 3);
  assert.equal(m0.phrasings[0], m0.say);

  const m1 = describeMove(fixtureRequest, fixtureSolve, 1, fixtureHoldTypes);
  assert.equal(m1.say, "Long reach, left hand to the next big sloper up, straight up, well above your head.");
  assert.equal(m1.is_crux, true);
  assert.ok(m1.crux_tips.length >= 1);

  const m2 = describeMove(fixtureRequest, fixtureSolve, 2, fixtureHoldTypes);
  // Sizes are relative to the route's other holds: here the jug is ordinary ("big" in the mixed route, next to small footholds).
  assert.equal(m2.say, "Long reach, right hand to the finish jug, up high, way out to your right.");
  assert.equal(m2.is_finish_hold, true);

  const m3 = describeMove(fixtureRequest, fixtureSolve, 3, fixtureHoldTypes);
  assert.equal(m3.is_match, true);
  assert.equal(m3.is_last_move, true);
  assert.equal(m3.say, "Match hands on the finish jug.");

  // No centimetres or metres in anything the coach says unprompted.
  for (const m of [m0, m1, m2, m3]) for (const p of m.phrasings) assert.doesNotMatch(p, /metre|centimetre|\d/);

  assert.equal(describeMove(fixtureRequest, fixtureSolve, 4), null);
});

test("colour is said only when it sets a hold apart", () => {
  const holds = fixtureRequest.holds.map((h) => (h.id === 12 ? { ...h, color: "#d02020" } : h));
  const req = { ...fixtureRequest, holds };
  assert.equal(describeMove(req, fixtureSolve, 0, fixtureHoldTypes).hold_description, "little red crimp");
  assert.equal(describeMove(fixtureRequest, fixtureSolve, 0, fixtureHoldTypes).hold_description, "little crimp");
});

test("a foot onto a hold a hand used is pointed out by that hand", () => {
  // Start: left hand on 3, right hand on 7. Hands go up, then the left foot steps onto 3.
  const j = (lh, rh, lf) => ({ head: [620, 950], hip: [620, 1250], lh, rh, lf, rf: [660, 1400],
    l_knee: [590, 1330], r_knee: [650, 1330] });
  const solve = {
    grade: fixtureSolve.grade,
    crux: 0,
    moves: [
      { i: 0, limb: "LH", hold: 15 },
      { i: 1, limb: "LF", hold: 3 },
    ],
    keyframes: [
      { move: 0, joints: j([540, 1100], [700, 1080], [580, 1400]) },
      { move: 1, joints: j([560, 760], [700, 1080], [580, 1400]) },
      { move: 2, joints: j([560, 760], [700, 1080], [540, 1100]) },
    ],
  };
  const foot = describeMove(fixtureRequest, solve, 1, fixtureHoldTypes);
  assert.equal(foot.hold_reference, "the jug your left hand started on");
  assert.equal(foot.short, "High left foot");
  assert.match(foot.say, /^High left foot, onto the jug your left hand started on\.$/);
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
  assert.match(route.moves[0], /^Left foot up.*, then reach, right hand to the next crimp up/);
  assert.match(route.moves[1], /^Feet up, then long reach, left hand to the next (big )?sloper up/);
  assert.match(route.moves[2], /^Right foot.*onto the (small )?foothold/);
  assert.equal(route.total_moves, 3);
  assert.equal(route.crux_move_number, 2);
});

test("footMoves is merge by default; skip calls hands only", async () => {
  const state = { request: footRequest, solve: footSolve };
  const merged = createCoachTools({ getState: () => state });
  const first = await call(merged.clientTools.get_next_move, { climber_finished_last_move: false });
  assert.match(first.say, /^Left foot up, then reach, right hand/);
  assert.deepEqual(first.move_indices, [0, 1]);

  const skip = createCoachTools({ getState: () => state, footMoves: "skip" });
  const s1 = await call(skip.clientTools.get_next_move, { climber_finished_last_move: false });
  const s2 = await call(skip.clientTools.get_next_move, { climber_finished_last_move: true });
  const s3 = await call(skip.clientTools.get_next_move, { climber_finished_last_move: true });
  assert.match(s1.say, /^Reach, right hand to the next (little )?crimp up/);
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
    "High right foot, then reach, right hand to the next little crimp up, out to your right at head height.",
    "Feet up, then long reach, left hand to the next big sloper up, straight up, well above your head.",
    "Feet up, then long reach, right hand to the big finish jug, up high, way out to your right.",
    "Match hands on the finish jug.",
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
    assert.doesNotMatch(m.say, /to the|onto|undefined|null/);
    assert.match(m.say, /^Smear your right foot|^Smear your left foot/);
  }
  assert.equal(describeMove(fixtureMixedRequest, fixtureMixedSolve, 3).say, "Smear your right foot up, out to your right at chest height.");

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
  const read = (f) => JSON.parse(readFileSync(join(CONTRACT, f), "utf8"));
  let request;
  if (existsSync(join(CONTRACT, "solve_request.json"))) {
    request = read("solve_request.json"); // the body solve.json answers
  } else {
    const analyze = existsSync(join(CONTRACT, "analyze.json")) ? read("analyze.json") : { image: { w: 1920, h: 1440 }, holds: [] };
    request = { image: analyze.image, holds: analyze.holds, climber_height_m: 1.75, wall_height_m: 4.0 };
  }
  const holdTypes = existsSync(join(CONTRACT, "hold_types.json")) ? read("hold_types.json") : undefined;
  const r = describeRoute(request, solve, holdTypes);
  assert.equal(r.total_moves, solve.moves.length);
  for (const say of r.moves) assert.ok(say.length > 5, say);
  for (const say of r.moves) assert.doesNotMatch(say, /undefined|null|NaN|metre|centimetre/);
  // Every move that names a route hold should be described with a target.
  const ids = new Set(request.holds.map((h) => h.id));
  solve.moves.forEach((m, i) => {
    if (m.hold != null && ids.has(m.hold) && m.limb.endsWith("H")) {
      const call = describeMove(request, solve, i, holdTypes);
      assert.ok(call.hold_reference && (call.say.includes(call.hold_reference) || call.is_match), call.say);
    }
  });
});

test("a first move onto the other hand's start hold is a match", () => {
  // Start pose: left hand on hold 3, right hand on hold 7, feet on the bare wall.
  const j = (lh, rh) => ({ head: [620, 950], hip: [620, 1250], lh, rh, l_elbow: [560, 1150], r_elbow: [690, 1140],
    lf: [580, 1400], rf: [660, 1400], l_knee: [590, 1330], r_knee: [650, 1330] });
  const solve = {
    grade: { font: "5c", v: "V1", low: "5b", high: "6a" },
    crux: 1,
    moves: [
      { i: 0, limb: "LH", hold: 7, load: 0.1, span_m: 0 },
      { i: 1, limb: "RH", hold: 12, load: 0.5, span_m: 0.5 },
    ],
    keyframes: [
      { move: 0, joints: j([540, 1100], [700, 1080]) },
      { move: 1, joints: j([692, 1080], [708, 1080]) },
      { move: 2, joints: j([692, 1080], [760, 900]) },
    ],
  };
  const first = describeMove(fixtureRequest, solve, 0, fixtureHoldTypes);
  assert.equal(first.is_match, true);
  assert.equal(first.say, "Match hands on the jug.");
  assert.equal(describeMove(fixtureRequest, solve, 1, fixtureHoldTypes).is_match, false);
  // Without keyframes the coach can't know the start holds, so it doesn't claim a match.
  assert.equal(describeMove(fixtureRequest, { ...solve, keyframes: [] }, 0, fixtureHoldTypes).is_match, false);
});
