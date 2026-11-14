// BetaCrux voice coach: client tool handlers.
//
// The frontend passes these to the ElevenLabs session:
//
//   import { Conversation } from "@elevenlabs/client";
//   import { createCoachTools } from "<path>/coach/coachTools.js";
//
//   const coach = createCoachTools({
//     getState: () => ({ request: solveRequest, solve: solveResponse, holdTypes }),
//     onHeightChange: async (heightM) => { /* call /solve again, update state */ },
//     onStepChange: (moveIndex) => { /* highlight solve.moves[moveIndex] in the UI */ },
//     getProgress: null, // live or demo mode: () => number of moves in solve.moves completed so far
//     footMoves: "merge", // "merge" (default): "Feet up, then right hand ..."; "skip": hands only; "call": every move
//   });
//   await Conversation.startSession({ agentId, connectionType: "webrtc", clientTools: coach.clientTools });
//
// Everything here reads only the shapes in the API contract (Documents/PLAN.md):
// `request` is the body sent to POST /solve, `solve` is its response, and
// `holdTypes` is the optional GET /hold-types list. No dependencies.
//
// Left and right are the climber's, assuming the photo is taken from behind the
// climber, facing the wall (image left = climber's left).

const LIMBS = {
  LH: { words: "left hand", joint: "lh", other: "RH" },
  RH: { words: "right hand", joint: "rh", other: "LH" },
  LF: { words: "left foot", joint: "lf", other: "RF" },
  RF: { words: "right foot", joint: "rf", other: "LF" },
};

const DEFAULT_TYPE_WORDS = {
  jug: "jug",
  crimp: "crimp",
  sloper: "sloper",
  pinch: "pinch",
  pocket: "pocket",
  volume: "volume",
  foot: "foothold",
  unknown: "hold",
};

const MIN_HEIGHT_M = 1.2;
const MAX_HEIGHT_M = 2.2;

/** Words for a hold type, preferring the name from GET /hold-types when given. */
export function holdTypeWords(type, holdTypes) {
  if (type === "unknown" || !type) return "hold";
  const entry = Array.isArray(holdTypes) ? holdTypes.find((t) => t.id === type) : null;
  if (entry && entry.name) return entry.name.toLowerCase();
  return DEFAULT_TYPE_WORDS[type] || type;
}

/** "about 50 centimetres" / "about 1.2 metres". */
export function distanceWords(metres) {
  if (metres < 1) {
    const cm = Math.max(10, Math.round((metres * 100) / 10) * 10);
    return `about ${cm} centimetres`;
  }
  const tenths = Math.round(metres * 10) / 10;
  if (tenths === 1) return "about a metre";
  return `about ${tenths % 1 === 0 ? tenths.toFixed(0) : tenths.toFixed(1)} metres`;
}

/** Direction from a pixel offset. dxPx is rightwards, dyUpPx is upwards. */
export function directionWords(dxPx, dyUpPx) {
  const ax = Math.abs(dxPx);
  const ay = Math.abs(dyUpPx);
  const vertical = dyUpPx >= 0 ? "up" : "down";
  const horizontal = dxPx >= 0 ? "right" : "left";
  if (ax < 0.4 * ay) return vertical;
  if (ay < 0.4 * ax) return horizontal;
  return `${vertical} and ${horizontal}`;
}

function isPoint(p) {
  return Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
}

/** Pixel position of a hold's centre. Assumes x, y are the centre (see README: open question). */
function holdPoint(hold) {
  return hold && Number.isFinite(hold.x) && Number.isFinite(hold.y) ? [hold.x, hold.y] : null;
}

/**
 * Where each limb is before move i, as hold ids, replayed from the move list.
 * Used to detect matches. Start holds are not assigned to a specific limb by
 * the contract, so limbs start as null.
 */
// The route hold a point is on: the nearest hold whose centre is within its own
// size (max of w, h) of the point. null if none, for example a foot on the wall.
function holdIdAt(point, holds) {
  if (!isPoint(point)) return null;
  let best = null;
  let bestD = Infinity;
  for (const h of holds || []) {
    if (!Number.isFinite(h.x) || !Number.isFinite(h.y)) continue;
    const d = Math.hypot(point[0] - h.x, point[1] - h.y);
    const reach = Math.max(h.w || 0, h.h || 0, 1);
    if (d <= reach && d < bestD) { best = h.id; bestD = d; }
  }
  return best;
}

const JOINT_OF = { LH: "lh", RH: "rh", LF: "lf", RF: "rf" };

// Which hold each limb is on before move i. The start pose (keyframes[0]) says
// where each limb begins, which `moves` alone doesn't: a first move onto the
// other hand's start hold is a match.
function limbHoldsBefore(moves, i, request, solve) {
  const at = { LH: null, RH: null, LF: null, RF: null };
  const start = solve && solve.keyframes && solve.keyframes[0] && solve.keyframes[0].joints;
  if (start && request) {
    for (const limb of Object.keys(at)) at[limb] = holdIdAt(start[JOINT_OF[limb]], request.holds);
  }
  for (let k = 0; k < i && k < moves.length; k++) at[moves[k].limb] = moves[k].hold;
  return at;
}

/**
 * Describe move i of a solved route as structured data plus one spoken sentence.
 * Returns null if i is out of range.
 */
export function describeMove(request, solve, i, holdTypes) {
  const moves = solve.moves || [];
  const move = moves[i];
  if (!move) return null;

  const limb = LIMBS[move.limb] || { words: "next limb", joint: null, other: null };
  // A move's hold may be missing from the request: for example a foot placed on
  // the wall rather than a hold. The contract doesn't define that case yet, so
  // any move whose `hold` isn't a route hold is described without a target.
  const hold = move.hold != null ? (request.holds || []).find((h) => h.id === move.hold) || null : null;
  const typeWords = hold ? holdTypeWords(hold.type, holdTypes) : null;

  // keyframes[i] is the pose before move i; keyframes[i + 1] is the pose after it.
  const kfBefore = (solve.keyframes || [])[i];
  const kfAfter = (solve.keyframes || [])[i + 1];
  const from = limb.joint && kfBefore && kfBefore.joints ? kfBefore.joints[limb.joint] : null;
  let to = limb.joint && kfAfter && kfAfter.joints ? kfAfter.joints[limb.joint] : null;
  if (!isPoint(to)) to = holdPoint(hold);

  const imageH = request.image && request.image.h;
  const metresPerPx = imageH && request.wall_height_m ? request.wall_height_m / imageH : null;

  const before = limbHoldsBefore(moves, i, request, solve);
  const isMatch = hold != null && limb.other != null && before[limb.other] === move.hold;
  const isCrux = solve.crux === i;

  let direction = null;
  let distanceM = null;
  if (isPoint(from) && isPoint(to)) {
    const dx = to[0] - from[0];
    const dyUp = from[1] - to[1];
    const px = Math.hypot(dx, dyUp);
    if (metresPerPx) distanceM = px * metresPerPx;
    if (distanceM == null || distanceM >= 0.1) direction = directionWords(dx, dyUp);
  }

  let sentence;
  const limbCap = limb.words[0].toUpperCase() + limb.words.slice(1);
  const target = typeWords ? ` to the ${typeWords}` : "";
  if (isMatch) {
    sentence = `${limbCap}, match on the ${typeWords}.`;
  } else if (direction && distanceM != null) {
    sentence = `${limbCap}, ${direction}, ${distanceWords(distanceM)}${target ? `,${target}` : ""}.`;
  } else if (direction) {
    sentence = `${limbCap}, ${direction}${target ? `,${target}` : ""}.`;
  } else if (target) {
    sentence = `${limbCap}${target}.`;
  } else {
    sentence = `Move your ${limb.words}.`;
  }

  return {
    move_number: i + 1,
    total_moves: moves.length,
    limb: limb.words,
    hold_type: typeWords,
    on_route_hold: hold != null,
    direction,
    distance_m: distanceM == null ? null : Math.round(distanceM * 100) / 100,
    is_match: isMatch,
    is_crux: isCrux,
    is_last_move: i === moves.length - 1,
    say: sentence,
  };
}

/**
 * Group moves into "calls": what the coach says in one turn.
 *
 * footMoves:
 *   "merge" (default)  foot moves are folded into the next hand move ("Feet up, then right hand ...").
 *                      Foot moves after the last hand move become one final call.
 *   "skip"             foot moves are not called at all.
 *   "call"             every move is its own call.
 *
 * Returns [{ moves: [move indices, in order], main: index of the move the call is about }].
 */
export function planCalls(solve, footMoves = "merge") {
  const moves = solve.moves || [];
  const isFoot = (m) => m.limb === "LF" || m.limb === "RF";
  const calls = [];
  let pendingFeet = [];
  moves.forEach((m, i) => {
    if (footMoves === "call") {
      calls.push({ moves: [i], main: i });
    } else if (isFoot(m)) {
      if (footMoves === "merge") pendingFeet.push(i);
    } else {
      calls.push({ moves: [...pendingFeet, i], main: i });
      pendingFeet = [];
    }
  });
  if (pendingFeet.length) calls.push({ moves: pendingFeet, main: pendingFeet[pendingFeet.length - 1] });
  return calls;
}

/** Short lead-in for foot moves folded into a hand call: "Feet up", "Left foot up", "Adjust your feet". */
function feetLeadIn(feet) {
  const allUp = feet.every((f) => f.direction && f.direction.startsWith("up"));
  const limbs = new Set(feet.map((f) => f.limb));
  if (limbs.size === 1) {
    const limb = feet[0].limb[0].toUpperCase() + feet[0].limb.slice(1);
    return allUp ? `${limb} up` : `Move your ${feet[0].limb}`;
  }
  return allUp ? "Feet up" : "Adjust your feet";
}

/** Describe one call (one coaching turn), which may merge foot moves into a hand move. */
export function describeCall(request, solve, calls, c, holdTypes) {
  const call = calls[c];
  if (!call) return null;
  const parts = call.moves.map((i) => describeMove(request, solve, i, holdTypes));
  const main = parts[call.moves.indexOf(call.main)];
  const feet = parts.filter((p) => p !== main);

  let say = main.say;
  if (feet.length) {
    const lead = feetLeadIn(feet);
    say = `${lead}, then ${main.say[0].toLowerCase()}${main.say.slice(1)}`;
  }
  return {
    ...main,
    move_number: c + 1,
    total_moves: calls.length,
    move_indices: call.moves,
    feet_first: feet.map((f) => f.say),
    is_crux: parts.some((p) => p.is_crux),
    is_last_move: c === calls.length - 1,
    say,
  };
}

/** Whole-route summary for get_route, counted in calls. */
export function describeRoute(request, solve, holdTypes, footMoves = "merge") {
  const calls = planCalls(solve, footMoves);
  const grade = solve.grade || {};
  const gradeWords = [grade.font && `Font ${grade.font}`, grade.v].filter(Boolean).join(", which is ");
  const range = grade.low && grade.high ? `somewhere between ${grade.low} and ${grade.high}` : null;
  const cruxCall = Number.isInteger(solve.crux) ? calls.findIndex((cl) => cl.moves.includes(solve.crux)) : -1;
  return {
    grade: gradeWords || "unknown",
    grade_range: range,
    total_moves: calls.length,
    crux_move_number: cruxCall >= 0 ? cruxCall + 1 : null,
    climber_height_m: request.climber_height_m ?? null,
    moves: calls.map((_, c) => describeCall(request, solve, calls, c, holdTypes).say),
  };
}

function sequenceKey(solve) {
  return (solve.moves || []).map((m) => `${m.limb}:${m.hold}`).join(",");
}

function err(message) {
  return JSON.stringify({ error: message });
}

const FOOT_MODES = ["merge", "skip", "call"];

/**
 * Build the client tools for one coaching session.
 *
 * options.getState      () => { request, solve, holdTypes? }   required
 * options.onHeightChange async (heightM) => void               re-solve; getState must reflect it afterwards
 * options.onStepChange  (moveIndex) => void                    optional UI hook: 0-based index into solve.moves of
 *                                                              the first move in the call being coached
 * options.getProgress   () => number                           optional live/demo hook: moves in solve.moves completed so far
 * options.footMoves     "merge" | "skip" | "call"              how foot moves are spoken (default "merge", see planCalls)
 */
export function createCoachTools(options) {
  const {
    getState,
    onHeightChange = null,
    onStepChange = null,
    getProgress = null,
    footMoves = "merge",
  } = options || {};
  if (typeof getState !== "function") throw new Error("createCoachTools needs getState()");
  if (!FOOT_MODES.includes(footMoves)) throw new Error(`footMoves must be one of ${FOOT_MODES.join(", ")}`);

  // `step` is the 0-based index of the call to make next. `called` records
  // whether that call has been read out, so "finished last move" only advances
  // after a move was actually called.
  let step = 0;
  let called = false;

  function readState() {
    const state = getState() || {};
    if (!state.request || !state.solve || !Array.isArray(state.solve.moves)) return null;
    return { ...state, calls: planCalls(state.solve, footMoves) };
  }

  // Tell the UI which move is being coached: the first move of the current
  // call, or solve.moves.length once the route is finished.
  function notify(state) {
    if (!onStepChange || !state) return;
    const call = state.calls[step];
    onStepChange(call ? call.moves[0] : state.solve.moves.length);
  }

  // Move to call `next`. The UI is notified by the caller, once per tool call.
  function setStep(next) {
    step = next;
    called = false;
  }

  /** Call index for a count of completed moves: the first call not fully done. */
  function callForProgress(calls, done) {
    const c = calls.findIndex((cl) => cl.moves[cl.moves.length - 1] >= done);
    return c === -1 ? calls.length : c;
  }

  const clientTools = {
    get_route: async () => {
      const state = readState();
      if (!state) return err("No solved route yet. Ask the climber to solve a route in the app first.");
      return JSON.stringify(describeRoute(state.request, state.solve, state.holdTypes, footMoves));
    },

    get_next_move: async (params = {}) => {
      const state = readState();
      if (!state) return err("No solved route yet. Ask the climber to solve a route in the app first.");
      const { calls } = state;
      const stepBefore = step;

      if (params.restart) {
        setStep(0);
      } else if (typeof getProgress === "function") {
        const done = Number(getProgress());
        if (Number.isInteger(done) && done >= 0) {
          const c = callForProgress(calls, done);
          if (c !== step) setStep(c);
        }
      } else if (params.climber_finished_last_move && called) {
        setStep(step + 1);
      }

      if (step !== stepBefore || !called) notify(state);
      if (step >= calls.length) {
        called = true;
        return JSON.stringify({ status: "finished", total_moves: calls.length, say: "That's the top. Route finished." });
      }
      called = true;
      return JSON.stringify(describeCall(state.request, state.solve, calls, step, state.holdTypes));
    },

    set_climber_height: async (params = {}) => {
      const height = Number(params.height_m);
      if (!Number.isFinite(height) || height < MIN_HEIGHT_M || height > MAX_HEIGHT_M) {
        return err(`Height must be between ${MIN_HEIGHT_M} and ${MAX_HEIGHT_M} metres.`);
      }
      if (typeof onHeightChange !== "function") return err("Changing height isn't available in this app.");
      const before = readState();
      const oldKey = before ? sequenceKey(before.solve) : null;
      try {
        await onHeightChange(height);
      } catch (e) {
        return err(`Re-solving failed: ${e && e.message ? e.message : e}`);
      }
      const after = readState();
      if (!after) return err("Re-solving didn't return a route.");
      setStep(0);
      notify(after);
      return JSON.stringify({
        climber_height_m: height,
        sequence_changed: oldKey == null ? null : oldKey !== sequenceKey(after.solve),
        ...describeRoute(after.request, after.solve, after.holdTypes, footMoves),
      });
    },
  };

  return {
    clientTools,
    getStep: () => step,
    reset: () => {
      const state = readState();
      setStep(0);
      notify(state);
    },
  };
}
