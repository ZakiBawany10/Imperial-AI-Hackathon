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
// Moves are described the way a coach on the mat talks: reach sized against
// the climber ("long reach", "big move"), the hold placed against their body
// ("just above your head", "by your left knee") and pointed out by landmark
// ("the jug your hands started on", "the next jug up"). Each move comes with
// structured facts, a main sentence (`say`) and two or three `phrasings` the
// agent can vary between. Distances in metres are only in `how_far`, for when
// the climber asks.
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

// ---------------------------------------------------------------------------
// How a coach on the mat describes a move
//
// No centimetres. Reach is sized against the climber ("long reach", "big
// move"), the target is placed against their body in the pose they are in
// before the move ("just above your head", "by your left knee"), and the hold
// is named the way you'd point it out ("the big start jug", "the next jug up",
// "the jug your hands started on"). Every word comes from the request, the
// solve response or GET /hold-types: nothing is invented.
// ---------------------------------------------------------------------------

/** Reach size from hand travel as a fraction of the climber's height. */
export function reachWords(fractionOfHeight) {
  const f = fractionOfHeight;
  if (!Number.isFinite(f)) return null;
  if (f < 0.2) return "short reach";
  if (f < 0.4) return "reach";
  if (f < 0.6) return "long reach";
  if (f < 0.85) return "big move";
  return "jump for it";
}

/** A coarse colour name from "#rrggbb": red, orange, yellow, green, blue, purple, pink, white, grey, black. */
export function colourName(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.2 || d < 0.08) return l > 0.8 ? "white" : l < 0.2 ? "black" : "grey";
  let hue;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 40) return "orange";
  if (hue < 72) return "yellow";
  if (hue < 165) return "green";
  if (hue < 260) return "blue";
  if (hue < 290) return "purple";
  return "pink";
}

function holdColour(h) {
  return (h && (h.color_name || colourName(h.color))) || null;
}

function median(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

/** "big", "small" or null: the hold's box area against the median route hold. */
function sizeWord(hold, holds) {
  if (!hold || !Number.isFinite(hold.w) || !Number.isFinite(hold.h) || (holds || []).length < 3) return null;
  const med = median(holds.map((h) => h.w * h.h));
  if (!med) return null;
  const ratio = (hold.w * hold.h) / med;
  if (ratio >= 1.6) return "big";
  if (ratio <= 0.6) return hold.type === "crimp" ? "little" : "small";
  return null;
}

/**
 * The hold's colour, only when it is worth saying: it differs from most route
 * holds, or another hold of the same type nearby has a different colour.
 */
function colourWorthSaying(hold, holds, bodyPx) {
  const mine = holdColour(hold);
  if (!mine) return null;
  const counts = {};
  for (const h of holds || []) {
    const c = holdColour(h);
    if (c) counts[c] = (counts[c] || 0) + 1;
  }
  const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (majority && majority[0] !== mine) return mine;
  const near = (holds || []).some((h) => h.id !== hold.id && h.type === hold.type && holdColour(h) && holdColour(h) !== mine
    && Math.hypot(h.x - hold.x, h.y - hold.y) < 0.3 * bodyPx);
  return near ? mine : null;
}

/** "big jug", "little crimp", "red sloper", "small foot chip". `label` goes before the type: "big finish jug". */
function holdDescription(hold, holds, holdTypes, bodyPx, label = null) {
  const type = holdTypeWords(hold.type, holdTypes);
  return [sizeWord(hold, holds), colourWorthSaying(hold, holds, bodyPx), label, type].filter(Boolean).join(" ");
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function lowerFirst(s) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Where a target point is relative to the climber's body in pose `joints`
 * (image coordinates, y down). `bodyPx` is the climber's height in pixels.
 * Returns { vertical, side, words } or null.
 */
function bodyPosition(target, joints, bodyPx, limb) {
  if (!isPoint(target) || !joints || !isPoint(joints.head) || !isPoint(joints.hip) || !(bodyPx > 0)) return null;
  const head = joints.head;
  const hip = joints.hip;
  const neckY = head[1] + 0.275 * (hip[1] - head[1]); // contract/README.md: neck is 27.5% down from head to hip
  const knees = [joints.l_knee, joints.r_knee].filter(isPoint);
  const kneeSide = limb === "LF" ? joints.l_knee : limb === "RF" ? joints.r_knee : null;
  const kneeY = isPoint(kneeSide) ? kneeSide[1] : knees.length ? knees.reduce((s, k) => s + k[1], 0) / knees.length : null;
  const up = (refY) => (refY - target[1]) / bodyPx; // > 0: target above ref

  let vertical;
  if (up(head[1]) > 0.3) vertical = "way above your head";
  else if (up(head[1]) > 0.08) vertical = "above your head";
  else if (up(head[1]) > -0.05) vertical = "at head height";
  else if (up(neckY) > -0.08) vertical = "at shoulder height";
  else if (up(hip[1]) > 0.12) vertical = "at chest height";
  else if (up(hip[1]) > -0.06) vertical = "by your hip";
  else if (kneeY != null && up(kneeY) > -0.06) {
    const side = limb === "LF" ? "left " : limb === "RF" ? "right " : "";
    vertical = up(kneeY) > 0.04 ? `just above your ${side}knee` : `by your ${side}knee`;
  } else vertical = "down low";

  const centreX = (head[0] + hip[0]) / 2;
  const dx = (target[0] - centreX) / bodyPx;
  const dir = dx >= 0 ? "right" : "left";
  let side = null;
  if (Math.abs(dx) >= 0.35) side = `way out to your ${dir}`;
  else if (Math.abs(dx) >= 0.12) side = `out to your ${dir}`;

  let words;
  if (vertical === "above your head" && !side) words = "just above your head";
  else if (vertical === "way above your head") {
    words = !side ? "straight up, well above your head" : side.startsWith("way") ? `up high, ${side}` : `up high to your ${dir}`;
  } else if (vertical === "above your head") words = `above your head, ${side}`;
  else if (vertical.includes("knee") || vertical === "by your hip") words = side ? `${side}, ${vertical}` : vertical;
  else if (vertical === "down low") words = side ? `down low, ${side}` : "down low";
  else words = side ? `${side} ${vertical}` : `right in front of you ${vertical}`;
  return { vertical, side, words };
}

/** "just above your right hand" when the target sits just above the other hand. */
function aboveOtherHand(target, joints, bodyPx, limb) {
  const other = limb === "LH" ? "rh" : limb === "RH" ? "lh" : null;
  const p = other && joints ? joints[other] : null;
  if (!isPoint(target) || !isPoint(p) || !(bodyPx > 0)) return null;
  const dx = Math.abs(target[0] - p[0]) / bodyPx;
  const upBy = (p[1] - target[1]) / bodyPx;
  if (dx < 0.12 && upBy > 0.05 && upBy < 0.35) return `just above your ${other === "rh" ? "right" : "left"} hand`;
  return null;
}

/** Hands that have been on each hold before move i: { holdId: { now: Set, ever: Set, startedOn: Set } }. */
function handHistory(moves, i, request, solve) {
  const start = solve && solve.keyframes && solve.keyframes[0] && solve.keyframes[0].joints;
  const pos = { LH: null, RH: null };
  const hist = new Map();
  const touch = (id, limb, isStart) => {
    if (id == null) return;
    if (!hist.has(id)) hist.set(id, { ever: new Set(), startedOn: new Set() });
    hist.get(id).ever.add(limb);
    if (isStart) hist.get(id).startedOn.add(limb);
  };
  if (start && request) {
    for (const limb of ["LH", "RH"]) {
      pos[limb] = holdIdAt(start[JOINT_OF[limb]], request.holds);
      touch(pos[limb], limb, true);
    }
  }
  for (let k = 0; k < i && k < moves.length; k++) {
    const m = moves[k];
    if (m.limb === "LH" || m.limb === "RH") {
      pos[m.limb] = m.hold;
      touch(m.hold, m.limb, false);
    }
  }
  return { pos, hist };
}

const HAND_WORDS = { LH: "left hand", RH: "right hand" };

/** How to point at a hold: "the finish jug", "the jug your hands started on", "the next jug up", "the big jug". */
function holdReference(hold, desc, ctx) {
  const { request, history, limbKey, from, holdTypes, bodyPx } = ctx;
  const labelled = (label) => holdDescription(hold, request.holds, holdTypes, bodyPx, label);
  const typeWords = holdTypeWords(hold.type, holdTypes);
  const isFinish = (request.finish || []).includes(hold.id);
  const isStart = (request.start || []).includes(hold.id);
  if (isFinish) return { ref: `the ${labelled("finish")}`, landmark: "finish" };

  const h = history.hist.get(hold.id);
  const holdingNow = ["LH", "RH"].filter((l) => history.pos[l] === hold.id && l !== limbKey);
  if (holdingNow.length) {
    const who = holdingNow.length === 2 ? "your hands are" : `your ${HAND_WORDS[holdingNow[0]]}'s`;
    return { ref: `the ${desc} ${who} on`, landmark: "held_by_hand" };
  }
  if (h && h.ever.size && limbKey !== "LH" && limbKey !== "RH") {
    const hands = [...h.ever];
    const started = h.startedOn.size === h.ever.size;
    const who = hands.length === 2 ? "your hands" : `your ${HAND_WORDS[hands[0]]}`;
    const verb = started ? "started on" : hands.length === 2 ? "were on" : "was on";
    return { ref: `the ${desc} ${who} ${verb}`, landmark: "used_by_hand" };
  }
  if (isStart) return { ref: `the ${labelled("start")}`, landmark: "start" };

  // "the next jug up" (hands only): no other route hold of this type between the hand and the target.
  if ((limbKey === "LH" || limbKey === "RH") && isPoint(from) && hold.y < from[1]) {
    const between = (request.holds || []).some((o) => o.id !== hold.id && o.type === hold.type && o.y < from[1] && o.y > hold.y);
    if (!between) return { ref: `the next ${desc} up`, landmark: "next_up" };
  }
  return { ref: `the ${desc}`, landmark: null, typeWords };
}

/** "just past the sloper": another route hold sits on the line to the target, close to it. */
function pastHold(from, hold, request, holdTypes, bodyPx) {
  if (!isPoint(from) || !hold || !(bodyPx > 0)) return null;
  const to = [hold.x, hold.y];
  const vx = to[0] - from[0];
  const vy = to[1] - from[1];
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return null;
  let best = null;
  for (const o of request.holds || []) {
    if (o.id === hold.id || o.type === "foot") continue;
    const t = ((o.x - from[0]) * vx + (o.y - from[1]) * vy) / len2;
    if (t <= 0.3 || t >= 0.95) continue;
    const off = Math.hypot(o.x - (from[0] + t * vx), o.y - (from[1] + t * vy)) / bodyPx;
    const gap = Math.hypot(o.x - to[0], o.y - to[1]) / bodyPx;
    if (off < 0.08 && gap < 0.3 && (!best || gap < best.gap)) best = { gap, words: `just past the ${holdTypeWords(o.type, holdTypes)}` };
  }
  return best ? best.words : null;
}

function cruxTips(facts, hold) {
  const tips = [];
  if (facts.reach === "big move" || facts.reach === "jump for it") tips.push("commit to it", "drive from your feet");
  if (facts.body_side && facts.body_side.startsWith("way out")) tips.push("hips in to the wall", "turn your hip in");
  if (hold && hold.type === "sloper") tips.push("arms straight, stay low on it");
  if (hold && hold.type === "crimp") tips.push("stay tight through your core");
  tips.push("hips in", "trust your feet");
  return [...new Set(tips)].slice(0, 3);
}

/**
 * Describe move i of a solved route: structured facts, one main sentence
 * (`say`) and two or three ways of saying it (`phrasings`). Returns null if i
 * is out of range.
 */
export function describeMove(request, solve, i, holdTypes) {
  const moves = solve.moves || [];
  const move = moves[i];
  if (!move) return null;

  const limb = LIMBS[move.limb] || { words: "next limb", joint: null, other: null };
  const isFoot = move.limb === "LF" || move.limb === "RF";
  // A foot on the bare wall has `hold: null`; any hold id not in the request is treated the same way.
  const hold = move.hold != null ? (request.holds || []).find((h) => h.id === move.hold) || null : null;
  const typeWords = hold ? holdTypeWords(hold.type, holdTypes) : null;

  // keyframes[i] is the pose before move i; keyframes[i + 1] is the pose after it.
  const kfBefore = (solve.keyframes || [])[i];
  const kfAfter = (solve.keyframes || [])[i + 1];
  const jointsBefore = kfBefore && kfBefore.joints ? kfBefore.joints : null;
  const from = limb.joint && jointsBefore ? jointsBefore[limb.joint] : null;
  let to = limb.joint && kfAfter && kfAfter.joints ? kfAfter.joints[limb.joint] : null;
  if (!isPoint(to)) to = holdPoint(hold);

  const imageH = request.image && request.image.h;
  const metresPerPx = imageH && request.wall_height_m ? request.wall_height_m / imageH : null;
  const heightM = request.climber_height_m || 1.75;
  let bodyPx = metresPerPx ? heightM / metresPerPx : null;
  if (!bodyPx && jointsBefore && isPoint(jointsBefore.head)) {
    const feetY = [jointsBefore.lf, jointsBefore.rf].filter(isPoint).map((p) => p[1]);
    if (feetY.length) bodyPx = (Math.max(...feetY) - jointsBefore.head[1]) * 1.15;
  }

  const before = limbHoldsBefore(moves, i, request, solve);
  const isMatch = hold != null && limb.other != null && before[limb.other] === move.hold;
  const isCrux = solve.crux === i;
  const isFinish = hold != null && (request.finish || []).includes(hold.id);

  let direction = null;
  let distanceM = null;
  let travelPx = null;
  if (isPoint(from) && isPoint(to)) {
    const dx = to[0] - from[0];
    const dyUp = from[1] - to[1];
    travelPx = Math.hypot(dx, dyUp);
    if (metresPerPx) distanceM = travelPx * metresPerPx;
    if (distanceM == null || distanceM >= 0.1) direction = directionWords(dx, dyUp);
  }
  const reach = !isFoot && !isMatch && travelPx != null && bodyPx ? reachWords(travelPx / bodyPx) : null;
  const target = hold ? [hold.x, hold.y] : to;
  const pos = bodyPosition(target, jointsBefore, bodyPx, move.limb);
  const nearHand = !isFoot ? aboveOtherHand(target, jointsBefore, bodyPx, move.limb) : null;
  const where = nearHand || (pos && pos.words) || null;

  const history = handHistory(moves, i, request, solve);
  const desc = hold ? holdDescription(hold, request.holds, holdTypes, bodyPx || 0) : null;
  const refInfo = hold ? holdReference(hold, desc, { request, history, limbKey: move.limb, from, holdTypes, bodyPx: bodyPx || 0 }) : null;
  const ref = refInfo ? refInfo.ref : null;
  const past = !isFoot && hold ? pastHold(from, hold, request, holdTypes, bodyPx) : null;

  const L = limb.words;          // "right hand"
  const Lc = cap(L);             // "Right hand"
  const goingDown = direction && direction.startsWith("down");
  let phrasings;

  if (isMatch) {
    const on = isFinish ? `the finish ${typeWords}` : `the ${typeWords}`;
    phrasings = isFoot
      ? [`${Lc} in next to your other foot, on ${on}.`, `Bring your ${L} onto ${on} with your other foot.`]
      : [`Match hands on ${on}.`, `Bring your ${L} in and match ${on}.`, `${Lc} in, match it.`];
  } else if (isFoot) {
    const side = move.limb === "LF" ? "left" : "right";
    const high = pos && (pos.vertical === "by your hip" || pos.vertical.includes("chest") || pos.vertical.includes("shoulder") || pos.vertical.includes("head"));
    const posBit = pos ? pos.words : null;
    if (!hold) {
      // Bare wall: smear.
      phrasings = [
        `Smear your ${L}${goingDown ? " down" : " up"}${posBit ? `, ${posBit}` : ""}.`,
        `${Lc} on the wall${posBit ? `, ${posBit}` : ""}. Just smear it.`,
      ];
      if (!posBit && !direction) phrasings = [`Move your ${L}.`, `Shift your ${L}.`];
    } else if (goingDown) {
      phrasings = [`Drop your ${L} to ${ref}.`, `${Lc} down onto ${ref}${posBit ? `, ${posBit}` : ""}.`];
    } else if (high) {
      phrasings = [
        `High ${side} foot, onto ${ref}.`,
        `Get your ${L} up high on ${ref}${posBit ? `, ${posBit}` : ""}.`,
        `Rock your ${L} up onto ${ref}.`,
      ];
    } else if (pos && pos.vertical.includes("knee")) {
      phrasings = [
        `${Lc} up onto ${ref}, ${pos.words}.`,
        `Bring your ${L} up ${pos.vertical}, onto ${ref}.`,
        `Step your ${L} up onto ${ref}.`,
      ];
    } else {
      phrasings = [
        `${Lc} ${direction ? (direction.startsWith("up") ? "up " : "across ") : ""}onto ${ref}${posBit ? `, ${posBit}` : ""}.`,
        `Step your ${L} onto ${ref}.`,
      ];
    }
  } else if (!hold) {
    phrasings = where ? [`Move your ${L} ${where}.`, `${Lc}, ${where}.`] : [`Move your ${L}.`];
  } else {
    const reachCap = reach ? cap(reach) : null;
    const whereBit = where ? `, ${where}` : "";
    const pastBit = past ? `, ${past}` : "";
    const aRef = refInfo.landmark ? ref : `${/^[aeiou]/i.test(desc) ? "an" : "a"} ${desc}`;
    const verb = { "short reach": "Grab it", reach: "Reach for it", "long reach": "Stretch for it", "big move": "Go big for it", "jump for it": "Jump for it" }[reach] || "Go get it";
    if (reach === "jump for it") {
      phrasings = [
        `Jump for it! ${Lc} to ${ref}${whereBit}.`,
        `${where ? cap(where) : "Up there"}, ${ref}. Jump for it with your ${L}.`,
        `Big dyno: ${L} to ${ref}${pastBit || whereBit}.`,
      ];
    } else {
      phrasings = [
        `${reachCap ? `${reachCap}, ${L}` : Lc} to ${ref}${whereBit}.`,
        `${where ? `${cap(where)}, there's ${aRef}` : `There's ${aRef}`}. ${verb} with your ${L}.`,
        `${Lc} to ${ref}${pastBit || whereBit}${reach === "big move" ? ". It's a big one" : ""}.`,
      ];
    }
    if (isFinish) phrasings.push(`Last one: ${L} to ${ref}${whereBit}.`);
  }
  phrasings = [...new Set(phrasings)].slice(0, 3);

  // Short form of a foot move, used when it is folded into the next hand call.
  let short = null;
  if (isFoot) {
    const side = move.limb === "LF" ? "Left" : "Right";
    if (!hold) short = `Smear your ${L}${goingDown ? " down" : " up"}`;
    else if (goingDown) short = `Drop your ${L}`;
    else if (pos && /hip|chest|shoulder|head/.test(pos.vertical)) short = `High ${side.toLowerCase()} foot`;
    else if (pos && pos.vertical.includes("knee")) short = `${side} foot up by your knee`;
    else short = `${side} foot up`;
  }

  const facts = {
    move_number: i + 1,
    total_moves: moves.length,
    limb: L,
    hold_type: typeWords,
    hold_description: desc,
    hold_reference: ref,
    on_route_hold: hold != null,
    reach,
    body_position: where,
    body_side: pos ? pos.side : null,
    direction,
    how_far: distanceM == null ? null : distanceWords(distanceM),
    distance_m: distanceM == null ? null : Math.round(distanceM * 100) / 100,
    is_match: isMatch,
    is_crux: isCrux,
    is_finish_hold: isFinish,
    is_last_move: i === moves.length - 1,
    say: phrasings[0],
    phrasings,
  };
  if (short) facts.short = short;
  if (isCrux) facts.crux_tips = cruxTips(facts, hold);
  return facts;
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

/** Lead-in for foot moves folded into a hand call: one foot's own phrase, or "Feet up" / "Sort your feet out". */
function feetLeadIn(feet) {
  if (feet.length === 1) return feet[0].short || feet[0].say.replace(/[.!]$/, "");
  const allUp = feet.every((f) => f.direction && f.direction.startsWith("up"));
  return allUp ? "Feet up" : "Sort your feet out";
}

/** Describe one call (one coaching turn), which may merge foot moves into a hand move. */
export function describeCall(request, solve, calls, c, holdTypes) {
  const call = calls[c];
  if (!call) return null;
  const parts = call.moves.map((i) => describeMove(request, solve, i, holdTypes));
  const main = parts[call.moves.indexOf(call.main)];
  const feet = parts.filter((p) => p !== main);

  let phrasings = main.phrasings;
  if (feet.length) {
    const lead = feetLeadIn(feet);
    const alt = `${lead} first`;
    phrasings = [
      `${lead}, then ${lowerFirst(main.phrasings[0])}`,
      ...main.phrasings.slice(1, 2).map((p) => `${alt}. ${p}`),
      ...main.phrasings.slice(2, 3).map((p) => `${lead}. Now ${lowerFirst(p)}`),
    ];
  }
  const isCrux = parts.some((p) => p.is_crux);
  const out = {
    ...main,
    move_number: c + 1,
    total_moves: calls.length,
    move_indices: call.moves,
    feet_first: feet.map((f) => f.say),
    is_crux: isCrux,
    is_last_move: c === calls.length - 1,
    say: phrasings[0],
    phrasings,
  };
  if (isCrux && !out.crux_tips) out.crux_tips = (parts.find((p) => p.crux_tips) || {}).crux_tips || ["hips in", "trust your feet"];
  return out;
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
