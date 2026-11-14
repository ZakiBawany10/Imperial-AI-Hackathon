// A human climber built from code: no model files, no textures, no imports.
//
//   import { createClimber, poseFromJoints2D, blendPoses } from "./climber.js";
//   const climber = createClimber(THREE, { style: "hologram" });
//   scene.add(climber.group);
//   climber.setPose(blendPoses(poseA, poseB, t, "RH"));
//   climber.update(dt);
//
// Everything is in metres in the wall's own frame: x to the right along the wall,
// y up the wall, z straight out of the wall toward the viewer. The wall is z = 0.
// The climber faces the wall, so the viewer normally sees the climber's back.
//
// How a pose is made: only the two hands, the two feet and a rough place for the
// hips are taken as given. The rest of the body is rebuilt in 3D: the hips and
// chest are moved until every hand and foot is within reach, then elbows and
// knees are placed from fixed bone lengths so no bone ever stretches.

// ----------------------------------------------------------------------------
// Small vector helpers on plain [x, y, z] arrays
// ----------------------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a, fallback) => { const l = len(a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : (fallback || [0, 1, 0]); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smooth = (lo, hi, x) => { const t = clamp((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
// Remove from a the part that points along the unit vector n.
const reject = (a, n) => madd(a, n, -dot(a, n));

// ----------------------------------------------------------------------------
// Body measurements, each as a share of the climber's height
// ----------------------------------------------------------------------------
const REF = 1.75;                       // lengths below written in metres are for a 1.75 m person
const M = (metres) => metres / REF;

const DIM = {
  upperArm: 0.186,                      // shoulder to elbow
  foreArm: 0.146,                       // elbow to wrist
  grip: M(0.092),                       // wrist to the point of the hand that sits on the hold
  palmOff: M(0.018),                    // how far the back of the hand sits off the grip point
  thigh: 0.245,                         // hip joint to knee
  shin: 0.246,                          // knee to ankle
  toeFwd: M(0.158),                     // ankle to toe tip, along the shoe
  toeDown: M(0.058),                    // ankle to toe tip, downward
  torso: 0.288,                         // middle of the hips to middle of the shoulders
  shoulderHalf: 0.105,                  // middle of the shoulders to one shoulder joint
  hipHalf: 0.05,                        // middle of the hips to one hip joint
  neckBase: M(0.03),                    // shoulder line up to where the neck starts
  headUp: M(0.205),                     // shoulder line up to the middle of the head
  holdDepth: M(0.035),                  // how far a gripped hold stands out of the wall
};

// ----------------------------------------------------------------------------
// Two-bone limb: where does the elbow or knee go?
// ----------------------------------------------------------------------------
// root and target are fixed, the two bones have lengths l1 and l2. The middle
// joint can sit anywhere on a circle around the root-target line; "pole" says
// which way it should prefer to point. zMin / zMax keep it out of the wall and
// stop it bending behind the body.
function twoBone(root, target, l1, l2, pole, zMin, zMax) {
  let ax = sub(target, root);
  let d = len(ax);
  if (d < 1e-6) { ax = [0, -1, 0]; d = 1e-6; }
  const axis = mul(ax, 1 / d);
  const dd = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-5);
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const r = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const c = madd(root, axis, a);
  let u = reject(pole, axis);
  if (len(u) < 1e-3) u = reject([0.3, 0.2, 1], axis);
  u = norm(u, [1, 0, 0]);
  const v = cross(axis, u);
  let th = 0;
  const amp = r * Math.hypot(u[2], v[2]);            // z along the circle is c.z + amp * cos(th - phi)
  if (amp > 1e-6) {
    const phi = Math.atan2(v[2], u[2]);
    const z0 = c[2] + amp * Math.cos(th - phi);
    const want = z0 < zMin ? zMin : (z0 > zMax ? zMax : null);
    if (want !== null) {
      const al = Math.acos(clamp((want - c[2]) / amp, -1, 1));
      const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      const t1 = wrap(phi + al), t2 = wrap(phi - al);
      th = Math.abs(t1) <= Math.abs(t2) ? t1 : t2;   // the allowed angle closest to the preferred one
    }
  }
  const cs = Math.cos(th) * r, sn = Math.sin(th) * r;
  return [c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn];
}

// ----------------------------------------------------------------------------
// The body solver: hands, feet and a rough hip position in, a whole pose out
// ----------------------------------------------------------------------------
// targets = { heightM, lHand, rHand, lFoot, rFoot (points on the holds, [x, y, z]),
//             pelvis ([x, y], rough), lookAt ([x, y, z], optional) }
export function poseFromTargets(targets) {
  const H = targets.heightM || REF;
  const La1 = DIM.upperArm * H, La2 = DIM.foreArm * H, La = La1 + La2;
  const Ll1 = DIM.thigh * H, Ll2 = DIM.shin * H, Ll = Ll1 + Ll2;
  const Lt = DIM.torso * H, sw = DIM.shoulderHalf * H, hw = DIM.hipHalf * H;
  const G = [targets.lHand, targets.rHand], T = [targets.lFoot, targets.rFoot];
  const SIDE = [-1, 1];

  // The shoulder line tips and turns toward the higher hand, the hip line toward the higher foot.
  const dyH = (G[1][1] - G[0][1]) / H, dyF = (T[1][1] - T[0][1]) / H;
  const rollC = clamp(dyH * 0.6, -0.6, 0.6);
  const yawC = clamp(dyH * 0.5, -0.35, 0.35);
  const rollP = clamp(dyF * 0.3 + rollC * 0.3, -0.3, 0.3);
  const yawP = yawC * 0.5;

  const P = [targets.pelvis[0], targets.pelvis[1], 0.13 * H];
  let C = [P[0], P[1] + Lt, 0.17 * H];
  let up, rc, bc, rp, bp;
  const S = [null, null], Hj = [null, null], W = [null, null], A = [null, null];
  const handY = [null, null], handZ = [null, null], footY = [null, null], footZ = [null, null];
  let bend = [0, 0];

  // Wrist for a hand on its hold. A hand that is in the air (free > 0) is also kept a forearm's
  // length away from its own shoulder, so it travels around the shoulder and never through it.
  const free = targets.free || {};
  const wristOf = (i) => {
    let w = madd(madd(G[i], handY[i], -DIM.grip * H), handZ[i], DIM.palmOff * H);
    const f = free[i ? "RH" : "LH"] || 0;
    if (f > 0) {
      const rMin = 0.5 * La;
      let v = sub(w, S[i]);
      const near = smooth(rMin, 0.5 * rMin, len(v));
      v = add(v, mul([SIDE[i] * 0.12, 0, -0.2], near * H / REF));
      const l = len(v);
      if (l < rMin) v = mul(v, 1 + (rMin / l - 1) * f);
      w = add(S[i], v);
      w[2] = Math.max(w[2], 0.03 * H);
    }
    return w;
  };

  const ITER = 14;
  for (let it = 0; it < ITER; it++) {
    // Frames of the chest and the hips.
    up = norm(sub(C, P));
    rc = norm(reject([1, rollC, -yawC], up), [1, 0, 0]);
    bc = cross(rc, up);
    rp = norm(reject([1, rollP, -yawP], up), [1, 0, 0]);
    bp = cross(rp, up);

    for (let i = 0; i < 2; i++) {
      // A hand reaching up lifts its shoulder a little.
      const lift = 0.028 * H * smooth(-0.05 * H, 0.3 * H, G[i][1] - C[1]);
      S[i] = madd(madd(C, rc, SIDE[i] * sw), up, lift);
      Hj[i] = madd(P, rp, SIDE[i] * hw);

      // Hand: fingers point from the shoulder toward the hold, palm against the wall.
      const dx = G[i][0] - S[i][0], dy = G[i][1] - S[i][1], n = Math.hypot(dx, dy);
      const hy = n > 1e-4 ? norm([dx / n, dy / n, -0.15]) : norm([0, 1, -0.15]);
      const hz = norm(reject([0, 0, 1], hy));
      handY[i] = hy; handZ[i] = hz;
      W[i] = wristOf(i);

      // Foot: the toe is on the hold. The more the leg is folded, the more the foot turns out.
      const dT = len(sub(T[i], Hj[i]));
      bend[i] = clamp((1 - dT / (Ll + 0.05 * H)) / 0.5, 0, 1);
      const turn = 0.3 + 0.75 * bend[i];
      const fwd = norm([SIDE[i] * Math.sin(turn), -0.2, -Math.cos(turn)]);
      const fz = mul(fwd, -1);
      const fy = norm(reject([0, 1, 0], fz));
      footY[i] = fy; footZ[i] = fz;
      A[i] = madd(madd(T[i], fy, DIM.toeDown * H), fz, DIM.toeFwd * H);
    }

    // Move the body (along the wall) until every hand and foot is within reach.
    // Hands win over feet: the last rounds look at the arms only.
    let cx = 0, cy = 0;
    const last = it >= ITER - 4;
    for (let i = 0; i < 2; i++) {
      const dv = sub(W[i], S[i]), d = len(dv), e = d - 0.985 * La;
      if (e > 0) { cx += dv[0] / d * e * (last ? 1 : 0.8); cy += dv[1] / d * e * (last ? 1 : 0.8); }
      if (!last) {
        const lv = sub(A[i], Hj[i]), ld = len(lv), le = ld - 0.985 * Ll;
        if (le > 0) { cx += lv[0] / ld * le * 0.4; cy += lv[1] / ld * le * 0.4; }
      }
    }
    P[0] += cx; P[1] += cy;

    // Hips: close to the wall, a little further out when the legs are folded up.
    P[2] = (0.125 + 0.05 * Math.max(bend[0], bend[1])) * H;

    // Chest: hang back from the wall on long arms when the hands are high, come in close when stretched.
    let zC = 0.24 * H;
    for (let i = 0; i < 2; i++) {
      const q = Math.min(Math.hypot(W[i][0] - S[i][0], W[i][1] - S[i][1]) / (0.93 * La), 1);
      const need = W[i][2] + 0.93 * La * (1 - q * q);
      const high = smooth(-0.3 * H, 0.0, G[i][1] - S[i][1]);      // 1 when the hand is above its shoulder
      zC = Math.min(zC, need * high + 0.17 * H * (1 - high));
    }
    zC = clamp(zC, 0.118 * H, 0.24 * H);
    zC = C[2] + (zC - C[2]) * (it === 0 ? 1 : 0.5);              // settle gently so the answer does not flip-flop
    const midX = (G[0][0] + G[1][0]) / 2;
    const lean = clamp(0.4 * (midX - P[0]) / Lt, -0.3, 0.3);      // the trunk leans toward the hands
    const dz = clamp(zC - P[2], -0.6 * Lt, 0.6 * Lt);
    const inPlane = Math.sqrt(Lt * Lt - dz * dz), ln = Math.hypot(lean, 1);
    C = [P[0] + (lean / ln) * inPlane, P[1] + (1 / ln) * inPlane, P[2] + dz];
  }

  // Recompute everything once from the final hips and chest so all parts agree.
  up = norm(sub(C, P));
  rc = norm(reject([1, rollC, -yawC], up), [1, 0, 0]); bc = cross(rc, up);
  rp = norm(reject([1, rollP, -yawP], up), [1, 0, 0]); bp = cross(rp, up);
  const out = { heightM: H, pelvis: P.slice(), chest: C.slice() };
  const E = [null, null], K = [null, null], Tact = [null, null];
  const off = { LH: false, RH: false, LF: false, RF: false };
  for (let i = 0; i < 2; i++) {
    const lift = 0.028 * H * smooth(-0.05 * H, 0.3 * H, G[i][1] - C[1]);
    S[i] = madd(madd(C, rc, SIDE[i] * sw), up, lift);
    Hj[i] = madd(P, rp, SIDE[i] * hw);
    W[i] = wristOf(i);
    A[i] = madd(madd(T[i], footY[i], DIM.toeDown * H), footZ[i], DIM.toeFwd * H);

    // Arm. A raised arm drops its elbow out to the side and down; an arm that points down
    // (a low hand) puts its elbow back and out. The rule turns smoothly with the arm, so the
    // elbow never snaps from one side to the other.
    const av = sub(W[i], S[i]), ad = len(av);
    if (ad > La) { W[i] = madd(S[i], av, (La * 0.999) / ad); off[i ? "RH" : "LH"] = true; }
    const an = mul(sub(W[i], S[i]), 1 / Math.max(len(sub(W[i], S[i])), 1e-6));
    const raised = smooth(-0.75, -0.1, an[1]);
    const poleE = mix([SIDE[i] * 0.5, 0, 1], [SIDE[i] * an[1] + SIDE[i] * 0.2, -SIDE[i] * an[0] - 0.8, 0], raised);
    E[i] = twoBone(S[i], W[i], La1, La2, poleE, 0.042 * H, 1e9);

    // Leg. The knee swings out to the side like a frog (a quarter turn outward from the line
    // hip-to-foot, leaning a little toward the wall) and never into the wall.
    const lv = sub(A[i], Hj[i]), ld = len(lv);
    Tact[i] = T[i];
    if (ld > Ll) {                                   // foot hold out of reach: the leg hangs straight toward it
      const A2 = madd(Hj[i], lv, (Ll * 0.999) / ld);
      Tact[i] = add(T[i], sub(A2, A[i])); A[i] = A2; off[i ? "RF" : "LF"] = true;
    }
    const ln = mul(sub(A[i], Hj[i]), 1 / Math.max(len(sub(A[i], Hj[i])), 1e-6));
    K[i] = twoBone(Hj[i], A[i], Ll1, Ll2, [-SIDE[i] * ln[1], SIDE[i] * ln[0], -0.25], 0.055 * H, P[2] + 0.05 * H);
  }

  // Head: look at the next hold, as far as a neck allows.
  const neck = madd(C, up, DIM.neckBase * H);
  const eye0 = madd(C, up, DIM.headUp * H);
  const look = targets.lookAt || (G[0][1] > G[1][1] ? G[0] : G[1]);
  let f = norm(sub(look, eye0), [0, 0, -1]);
  let fx = dot(f, rc), fy = dot(f, up), fz = Math.min(dot(f, bc), -0.25);
  const yaw = clamp(Math.atan2(fx, -fz), -1.0, 1.0) * 0.8;
  const pitch = clamp(Math.atan2(fy, Math.hypot(fx, fz)), -0.7, 0.9) * 0.6;
  fx = Math.sin(yaw) * Math.cos(pitch); fy = Math.sin(pitch); fz = -Math.cos(yaw) * Math.cos(pitch);
  f = norm(add(add(mul(rc, fx), mul(up, fy)), mul(bc, fz)));
  const headUpV = norm(reject(up, f));
  const head = madd(neck, norm(add(up, headUpV)), (DIM.headUp - DIM.neckBase) * H);

  Object.assign(out, {
    head, neck,
    lShoulder: S[0], rShoulder: S[1], lElbow: E[0], rElbow: E[1], lWrist: W[0], rWrist: W[1],
    lHand: madd(madd(W[0], handY[0], DIM.grip * H), handZ[0], -DIM.palmOff * H),
    rHand: madd(madd(W[1], handY[1], DIM.grip * H), handZ[1], -DIM.palmOff * H),
    lHip: Hj[0], rHip: Hj[1], lKnee: K[0], rKnee: K[1], lAnkle: A[0], rAnkle: A[1],
    lFoot: Tact[0], rFoot: Tact[1],
    // Directions (unit vectors) that say which way each part faces.
    chestRight: rc, chestUp: up, chestBack: bc,
    pelvisRight: rp, pelvisUp: up, pelvisBack: bp,
    headForward: f, headUp: headUpV,
    lHandDir: handY[0], lHandBack: handZ[0], rHandDir: handY[1], rHandBack: handZ[1],
    lFootUp: footY[0], lFootBack: footZ[0], rFootUp: footY[1], rFootBack: footZ[1],
    lookAt: look.slice(),
    offTarget: off,                                  // true for a hand or foot that could not reach its hold
    targets: {
      heightM: H, lHand: G[0].slice(), rHand: G[1].slice(), lFoot: T[0].slice(), rFoot: T[1].slice(),
      pelvis: [targets.pelvis[0], targets.pelvis[1]], lookAt: look.slice(),
    },
  });
  return out;
}

// One keyframe's "joints" from POST /solve (pixels of the photo, y down) to a 3D pose.
// ctx = { imageW, imageH, wallHeightM, climberHeightM, lookAt?: [xPx, yPx] }
// x = 0 is the left edge of the photo and y = 0 is its bottom edge.
export function poseFromJoints2D(joints, ctx) {
  const H = ctx.climberHeightM || REF;
  const m = (ctx.wallHeightM || 4) / ctx.imageH;
  const at = (p, z) => [p[0] * m, (ctx.imageH - p[1]) * m, z];
  const zh = DIM.holdDepth * H, zf = DIM.holdDepth * H * 0.9;
  const targets = {
    heightM: H,
    lHand: at(joints.lh, zh), rHand: at(joints.rh, zh),
    lFoot: at(joints.lf, zf), rFoot: at(joints.rf, zf),
    pelvis: [joints.hip[0] * m, (ctx.imageH - joints.hip[1]) * m],
  };
  // Two hands on one hold arrive almost on top of each other: give each its own half of the hold.
  const gap = targets.rHand[0] - targets.lHand[0], minGap = 0.05 * H;
  if (Math.abs(targets.rHand[1] - targets.lHand[1]) < 0.03 * H && Math.abs(gap) < minGap) {
    const mid = (targets.rHand[0] + targets.lHand[0]) / 2;
    targets.lHand[0] = mid - minGap / 2; targets.rHand[0] = mid + minGap / 2;
  }
  if (ctx.lookAt) targets.lookAt = at(ctx.lookAt, zh);
  return poseFromTargets(targets);
}

// A smooth in-between of two poses, t from 0 (pose a) to 1 (pose b).
// movingLimb ("LH" | "RH" | "LF" | "RF" | null) is the hand or foot this move is about:
// it lifts off the wall and travels in an arc. Feet that change place step first,
// then the body shifts, then the hand reaches.
export function blendPoses(a, b, t, movingLimb) {
  t = clamp(t, 0, 1);
  const ta = a.targets, tb = b.targets;
  if (!ta || !tb) return blendPlain(a, b, t);
  const H = tb.heightM;
  const KEY = { LH: "lHand", RH: "rHand", LF: "lFoot", RF: "rFoot" };
  const moved = (k) => len(sub(ta[k], tb[k])) > 0.01 * H;
  // Each limb gets its own slices of the move. A foot that has far to go walks up the wall
  // in several steps, taking turns with the other foot so one of them is always planted.
  const handIsMain = movingLimb === "LH" || movingLimb === "RH";
  const win = {};
  const walkers = ["LF", "RF"].filter((n) => n !== movingLimb && moved(KEY[n]));
  const counts = walkers.map((n) => Math.max(1, Math.round(len(sub(ta[KEY[n]], tb[KEY[n]])) / (0.3 * H))));
  const slots = [];
  for (let k = 0; k < Math.max(0, ...counts); k++) walkers.forEach((n, i) => { if (k < counts[i]) slots.push(n); });
  const span = !movingLimb ? [0.05, 0.9] : (handIsMain ? [0.0, 0.72] : [0.0, 0.4]);
  slots.forEach((n, i) => {
    const w = (span[1] - span[0]) / slots.length;
    (win[n] = win[n] || []).push([span[0] + i * w, span[0] + (i + 1) * w]);
  });
  if (movingLimb) win[movingLimb] = [[slots.length ? (handIsMain ? 0.45 : 0.42) : 0.12, 1.0]];
  const other = { LH: "RH", RH: "LH" }[movingLimb];
  for (const n of ["LH", "RH", "LF", "RF"]) if (!win[n]) win[n] = [n === other ? [0.0, 0.4] : [0.1, 0.9]];
  const bodyWin = slots.length && handIsMain ? [0.02, 0.82] : [0.0, 0.9];
  const free = {};

  const path = (n) => {
    const k = KEY[n], p0 = ta[k], p1 = tb[k], hand = n === "LH" || n === "RH";
    const d = len(sub(p1, p0)), stepD = d / win[n].length;
    let prog = 0, arc = 0;
    for (const w of win[n]) { const e = ease((t - w[0]) / (w[1] - w[0])); prog += e / win[n].length; arc += Math.sin(Math.PI * e); }
    const p = mix(p0, p1, prog);
    if (d > 0.01 * H) {                              // lift off the wall in an arc instead of sliding along it
      const lift = hand ? clamp(0.06 + 0.12 * stepD, 0.06, 0.14) : clamp(0.05 + 0.14 * stepD, 0.05, 0.12);
      p[2] += lift * (H / REF) * arc;
      if (hand) free[n] = Math.min(1, arc * 3);
    }
    return p;
  };
  const eb = ease((t - bodyWin[0]) / (bodyWin[1] - bodyWin[0]));

  // Eyes go to where the moving hand or foot will land, early in the move.
  const dest = movingLimb ? tb[KEY[movingLimb]] : tb.lookAt;
  let look = mix(ta.lookAt, dest, smooth(0.0, 0.3, t));
  look = mix(look, tb.lookAt, smooth(0.85, 1.0, t));

  return poseFromTargets({
    heightM: ta.heightM + (tb.heightM - ta.heightM) * t,
    lHand: path("LH"), rHand: path("RH"), lFoot: path("LF"), rFoot: path("RF"),
    pelvis: [ta.pelvis[0] + (tb.pelvis[0] - ta.pelvis[0]) * eb, ta.pelvis[1] + (tb.pelvis[1] - ta.pelvis[1]) * eb],
    lookAt: look, free,
  });
}

// Fallback for poses that were not made by this module: blend every joint in a straight line.
function blendPlain(a, b, t) {
  const out = {};
  for (const k of Object.keys(b)) {
    const x = a[k], y = b[k];
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) out[k] = x.map((v, i) => v + (y[i] - v) * t);
    else out[k] = t < 0.5 && x !== undefined ? x : y;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Shapes. Every body part is a "loft": rings of points joined into a smooth skin.
// All shapes are built for a body of height 1 and scaled to the climber.
// ----------------------------------------------------------------------------
function loft(nRings, nSeg, fn) {
  const pos = new Float32Array(nRings * nSeg * 3), idx = [];
  for (let j = 0; j < nRings; j++) for (let i = 0; i < nSeg; i++) {
    const p = fn(j, (i / nSeg) * Math.PI * 2, i);
    pos.set(p, (j * nSeg + i) * 3);
  }
  for (let j = 0; j < nRings - 1; j++) for (let i = 0; i < nSeg; i++) {
    const a = j * nSeg + i, b = j * nSeg + ((i + 1) % nSeg), c = a + nSeg, d = b + nSeg;
    idx.push(a, c, b, b, c, d);
  }
  return { pos, idx, nRings, nSeg };
}

// Radius along a limb: [[t, r], ...] with t from 0 to 1, blended smoothly between the stops.
function radiusAt(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const u = (t - stops[k - 1][0]) / (stops[k][0] - stops[k - 1][0]);
      return stops[k - 1][1] + (stops[k][1] - stops[k - 1][1]) * (u * u * (3 - 2 * u));
    }
  }
  return stops[stops.length - 1][1];
}

// A limb along +y from 0 to length, round at both ends so it joins cleanly at the joints.
// bulge(t) -> z offset lets a muscle sit to one side (the calf sits at the back of the shin).
function limbShape(length, stops, nSeg, bodyN, bulge) {
  const rings = [], cap = 3;
  const r0 = stops[0][1], r1 = stops[stops.length - 1][1];
  for (let k = 0; k < cap; k++) { const a = (k / cap) * Math.PI / 2; rings.push([-r0 * Math.cos(a), Math.max(r0 * Math.sin(a), 1e-5), 0]); }
  for (let k = 0; k <= bodyN; k++) { const t = k / bodyN; rings.push([t * length, radiusAt(stops, t), bulge ? bulge(t) : 0]); }
  for (let k = 1; k <= cap; k++) { const a = (k / cap) * Math.PI / 2; rings.push([length + r1 * Math.sin(a), Math.max(r1 * Math.cos(a), 1e-5), 0]); }
  const part = loft(rings.length, nSeg, (j, phi) => [rings[j][1] * Math.cos(phi), rings[j][0], rings[j][1] * Math.sin(phi) + rings[j][2]]);
  part.ringY = rings.map((r) => r[0]);
  return part;
}

function ellipsoid(rx, ry, rz, nSeg, nRings, shape) {
  return loft(nRings, nSeg, (j, phi) => {
    const v = j / (nRings - 1), y = -Math.cos(Math.PI * v), rr = Math.max(Math.sin(Math.PI * v), 1e-4);
    const p = [rr * Math.cos(phi) * rx, y * ry, rr * Math.sin(phi) * rz];
    return shape ? shape(p, y, phi) : p;
  });
}

// Turn a part about the x axis (angle in radians) and move it.
function placed(part, angleX, offset) {
  const c = Math.cos(angleX), s = Math.sin(angleX), p = part.pos;
  for (let i = 0; i < p.length; i += 3) {
    const y = p[i + 1], z = p[i + 2];
    p[i] += offset[0]; p[i + 1] = y * c - z * s + offset[1]; p[i + 2] = y * s + z * c + offset[2];
  }
  return part;
}

function merged(parts) {
  let n = 0; for (const p of parts) n += p.pos.length;
  const pos = new Float32Array(n), idx = [];
  let o = 0;
  for (const p of parts) { pos.set(p.pos, o); for (const i of p.idx) idx.push(i + o / 3); o += p.pos.length; }
  return { pos, idx };
}

// part -> THREE.BufferGeometry. paint(x, y, z, vertexIndex) -> [r, g, b, accent, tint]:
// rgb is the colour in the "solid" look, accent (0..1) marks magenta parts in the "hologram" look,
// tint (0..1) is how strongly the effort colour shows on this part in the "solid" look.
function toGeometry(THREE, part, paint) {
  const g = new THREE.BufferGeometry();
  const n = part.pos.length / 3;
  g.setAttribute("position", new THREE.BufferAttribute(part.pos, 3));
  g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(part.idx), 1) : new THREE.BufferAttribute(new Uint16Array(part.idx), 1));
  const col = new Float32Array(n * 3), mark = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const c = paint(part.pos[i * 3], part.pos[i * 3 + 1], part.pos[i * 3 + 2], i);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; mark[i * 2] = c[3] || 0; mark[i * 2 + 1] = c[4] || 0;
  }
  g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aMark", new THREE.BufferAttribute(mark, 2));
  g.computeVertexNormals();
  return g;
}

// The trunk from crotch to the base of the neck, as rings: how far along the spine
// (0 = hips, 1 = shoulder line), half width, half depth, and a nudge toward the back.
const TORSO_RINGS = [
  [-0.150, 0.004, 0.004, 0.000],
  [-0.135, 0.070, 0.058, 0.004],
  [-0.085, 0.132, 0.092, 0.008],
  [-0.020, 0.160, 0.106, 0.012],
  [0.060, 0.166, 0.108, 0.012],
  [0.160, 0.156, 0.098, 0.004],
  [0.270, 0.139, 0.088, -0.004],
  [0.380, 0.134, 0.085, -0.006],
  [0.500, 0.144, 0.091, -0.002],
  [0.620, 0.160, 0.101, 0.004],
  [0.740, 0.174, 0.109, 0.008],
  [0.850, 0.181, 0.110, 0.010],
  [0.940, 0.184, 0.104, 0.010],
  [1.010, 0.170, 0.092, 0.010],
  [1.065, 0.122, 0.076, 0.008],
  [1.120, 0.068, 0.060, 0.004],
  [1.170, 0.050, 0.050, 0.002],
  [1.185, 0.004, 0.004, 0.000],
].map((r) => [r[0], M(r[1]), M(r[2]), M(r[3])]);
const TORSO_SEG = 22;

// ----------------------------------------------------------------------------
// Shaders. The figure lights itself, so it looks the same in any scene.
// ----------------------------------------------------------------------------
const VERT = `
attribute vec3 aColor;
attribute vec2 aMark;
varying vec3 vNv;      // surface direction as the camera sees it
varying vec3 vVv;      // direction to the camera
varying vec3 vNw;      // surface direction in the world
varying vec3 vWorld;
varying vec3 vColor;
varying float vAccent;
varying float vTintable;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNv = normalize(normalMatrix * normal);
  vVv = -mv.xyz;
  vNw = normalize(mat3(modelMatrix) * normal);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vColor = aColor;
  vAccent = aMark.x;
  vTintable = aMark.y;
  gl_Position = projectionMatrix * mv;
}`;

const DEPTH_FRAG = `void main() { gl_FragColor = vec4(0.0); }`;

const HOLO_FRAG = `
uniform vec3 uBase;        // body colour: calm colour, shifting to amber and red with effort
uniform vec3 uAccent;      // colour of the accents
uniform float uTime;
uniform float uHighlight;  // 1 on the hand or foot that is moving
uniform float uStrain;     // 1 when the climber is not stable
varying vec3 vNv;
varying vec3 vVv;
varying vec3 vWorld;
varying float vAccent;
void main() {
  vec3 N = normalize(vNv), V = normalize(vVv);
  float facing = abs(dot(N, V));
  float rim = pow(1.0 - facing, 2.0);

  // Thin rings of light every few centimetres, climbing up the body: they show its roundness.
  float u = vWorld.y * 16.0 - uTime * 0.55;
  float w = fwidth(u) * 1.2 + 0.035;
  float d = abs(fract(u) - 0.5);
  float rings = 1.0 - smoothstep(w * 0.5, w * 1.5, d);
  // Fine screen lines, like an old monitor.
  float fine = 0.5 + 0.5 * sin(gl_FragCoord.y * 2.1 + uTime * 5.0);
  // One wide band of light that sweeps up every few seconds.
  float sweep = exp(-pow((fract(vWorld.y * 0.22 - uTime * 0.16) - 0.5) * 11.0, 2.0));

  vec3 tint = mix(uBase, uAccent, vAccent);
  float pulse = 0.6 + 0.4 * sin(uTime * 9.0);
  tint = mix(tint, mix(uAccent, vec3(1.0), 0.45), uHighlight * pulse);

  float flicker = 1.0 - uStrain * 0.25 * step(0.72, fract(sin(floor(uTime * 24.0)) * 43758.5));
  float glow = 0.20 + 1.35 * rim + 0.55 * rings * (0.35 + 0.65 * rim) + 0.65 * sweep * (0.25 + rim) + 0.5 * uHighlight;
  glow *= (0.84 + 0.16 * fine) * flicker;
  vec3 col = tint * glow + vec3(1.0) * pow(rim, 4.0) * 0.55;

  // The inside is a dark tinted glass, so the body also reads on a bright photo.
  float alpha = clamp(0.50 + 0.6 * rim + 0.25 * rings + 0.25 * sweep + 0.2 * uHighlight, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SOLID_FRAG = `
uniform vec3 uTint;        // effort colour
uniform float uTintAmount;
uniform vec3 uRim;
uniform float uTime;
uniform float uHighlight;
varying vec3 vNv;
varying vec3 vVv;
varying vec3 vNw;
varying vec3 vColor;
varying float vTintable;
void main() {
  vec3 N = normalize(vNw);
  vec3 Nv = normalize(vNv), V = normalize(vVv);
  // A soft key light from above and behind the viewer's left shoulder, sky light from above,
  // and a little light bounced back from the wall.
  vec3 L = normalize(vec3(-0.45, 0.75, 0.6));
  float key = clamp(dot(N, L) * 0.6 + 0.4, 0.0, 1.0);
  key = key * key;
  float sky = 0.5 + 0.5 * N.y;
  float bounce = clamp(-N.z, 0.0, 1.0);
  // The shirt always wears the effort colour; skin and shorts only pick up a little of it when working hard.
  vec3 base = mix(vColor, uTint * 0.82, vTintable > 0.5 ? 1.0 : vTintable * uTintAmount * 2.0);
  float edge = abs(dot(Nv, V));
  vec3 col = base * (0.13 + 0.25 * sky + 1.05 * key + 0.10 * bounce) * (0.72 + 0.28 * edge);
  // Soft shine.
  vec3 Hh = normalize(normalize(vec3(-0.35, 0.6, 0.75)) + V);
  col += vec3(0.10) * pow(max(dot(Nv, Hh), 0.0), 24.0);
  // Rim light: a bright edge so the figure stands out from any background.
  float rim = pow(1.0 - abs(dot(Nv, V)), 2.6);
  float pulse = 0.6 + 0.4 * sin(uTime * 9.0);
  col += uRim * rim * (0.75 + 1.6 * uHighlight * pulse);
  col = mix(col, col + uRim * 0.22, uHighlight * pulse);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const GLOW_FRAG = `
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vColor;
void main() {
  float r = length(vColor.xy);
  float a = smoothstep(1.0, 0.0, r);
  gl_FragColor = vec4(uColor, a * a * uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Effort 0..1 to a colour: calm colour, then green, amber, orange, red.
function effortColour(THREE, calm, effort, out) {
  const stops = [[0.0, calm], [0.38, 0x5dffa8], [0.62, 0xffb21f], [0.84, 0xff5a1f], [1.0, 0xff2438]];
  const e = clamp(effort, 0, 1);
  const c0 = new THREE.Color(), c1 = new THREE.Color();
  for (let k = 1; k < stops.length; k++) {
    if (e <= stops[k][0]) {
      c0.set(stops[k - 1][1]); c1.set(stops[k][1]);
      return out.copy(c0).lerp(c1, (e - stops[k - 1][0]) / (stops[k][0] - stops[k - 1][0]));
    }
  }
  return out.set(stops[stops.length - 1][1]);
}

// ----------------------------------------------------------------------------
// The figure
// ----------------------------------------------------------------------------
// options = {
//   style: "hologram" (default) | "solid",
//   heightM: 1.75,          // used until the first pose arrives; each pose carries its own height
//   wallGlow: true,         // soft light (hologram) or shadow (solid) cast on the wall behind the body
//   colors: { calm, accent, skin, shirt, shorts, shoe, sole, hair, bag }   // hex numbers, all optional
// }
export function createClimber(THREE, options = {}) {
  const colors = Object.assign({
    calm: 0x1fe5ff, accent: 0xff2bd6,
    skin: 0xd79a72, shirt: 0x16b8c9, shorts: 0x3a4664, shoe: 0xd9e63a, sole: 0x16181c, hair: 0x2b1d16, bag: 0xe0358f,
  }, options.colors || {});
  const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const SKIN = rgb(colors.skin), SHIRT = rgb(colors.shirt), SHORTS = rgb(colors.shorts), SHOE = rgb(colors.shoe),
    SOLE = rgb(colors.sole), HAIR = rgb(colors.hair), BAG = rgb(colors.bag);

  const group = new THREE.Group();
  group.name = "climber";
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  // ---- materials: one pair (hologram, solid) per limb so a single limb can be highlighted ----
  const shared = {
    uTime: { value: 0 }, uBase: { value: new THREE.Color(colors.calm) }, uAccent: { value: new THREE.Color(colors.accent) },
    uStrain: { value: 0 }, uTint: { value: new THREE.Color(colors.calm) }, uTintAmount: { value: 0 },
    uRim: { value: new THREE.Color(0x9fdcff) },
  };
  const LIMBS = ["core", "LH", "RH", "LF", "RF"];
  const mats = {};
  for (const name of LIMBS) {
    const uHighlight = { value: 0 };
    mats[name] = {
      uHighlight,
      holo: keep(new THREE.ShaderMaterial({
        uniforms: { uBase: shared.uBase, uAccent: shared.uAccent, uTime: shared.uTime, uStrain: shared.uStrain, uHighlight },
        vertexShader: VERT, fragmentShader: HOLO_FRAG, transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth,
        extensions: { derivatives: true },
      })),
      solid: keep(new THREE.ShaderMaterial({
        uniforms: { uTint: shared.uTint, uTintAmount: shared.uTintAmount, uRim: shared.uRim, uTime: shared.uTime, uHighlight },
        vertexShader: VERT, fragmentShader: SOLID_FRAG,
      })),
    };
  }
  // Hologram only: the body is first drawn into the depth buffer alone, so that only its
  // front surface is coloured and overlapping parts do not show through each other.
  const depthMat = keep(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DEPTH_FRAG, transparent: true, colorWrite: false, depthWrite: true }));

  const parts = [];                                   // { mesh, twin, limb, solidOnly }
  function addPart(geometry, limb, opts = {}) {
    keep(geometry);
    const mesh = new THREE.Mesh(geometry, mats[limb].holo);
    mesh.frustumCulled = false;
    const twin = new THREE.Mesh(geometry, depthMat);
    twin.frustumCulled = false;
    twin.renderOrder = 998;
    mesh.add(twin);
    group.add(mesh);
    parts.push({ mesh, twin, limb, solidOnly: !!opts.solidOnly });
    return mesh;
  }

  // ---- limbs ----
  const skin = () => [SKIN[0], SKIN[1], SKIN[2], 0, 0.1];
  const shorts = () => [SHORTS[0], SHORTS[1], SHORTS[2], 0, 0.15];
  const upperArmG = toGeometry(THREE, limbShape(DIM.upperArm, [[0, M(0.060)], [0.18, M(0.058)], [0.45, M(0.050)], [0.8, M(0.042)], [1, M(0.039)]], 12, 7), skin);
  const foreArmG = toGeometry(THREE, limbShape(DIM.foreArm, [[0, M(0.039)], [0.25, M(0.046)], [0.7, M(0.034)], [1, M(0.028)]], 12, 6), skin);
  // Shorts cover the top half of the thigh; the cloth sits a touch proud of the skin.
  const thighPart = limbShape(DIM.thigh, [[0, M(0.086)], [0.25, M(0.084)], [0.50, M(0.074)], [0.56, M(0.066)], [0.8, M(0.058)], [1, M(0.053)]], 14, 9);
  const thighG = toGeometry(THREE, thighPart, (x, y) => (y < DIM.thigh * 0.53 ? shorts() : skin()));
  const calfG = toGeometry(THREE, limbShape(DIM.shin, [[0, M(0.052)], [0.28, M(0.056)], [0.62, M(0.042)], [1, M(0.034)]], 12, 7,
    (t) => M(0.014) * Math.sin(Math.PI * clamp(t / 0.62, 0, 1))), skin);

  const seg = {
    lUpperArm: addPart(upperArmG, "LH"), rUpperArm: addPart(upperArmG, "RH"),
    lForeArm: addPart(foreArmG, "LH"), rForeArm: addPart(foreArmG, "RH"),
    lThigh: addPart(thighG, "LF"), rThigh: addPart(thighG, "RF"),
    lCalf: addPart(calfG, "LF"), rCalf: addPart(calfG, "RF"),
  };

  // ---- hands: wrist at the origin, fingers along +y, palm toward -z (the wall), curled over the hold ----
  function handGeometry(sideSign) {
    const palm = placed(ellipsoid(M(0.043), M(0.050), M(0.017), 10, 6), 0, [0, M(0.046), 0]);
    const curl1 = -0.85, curl2 = -1.95;
    const k = [0, M(0.086), M(-0.002)];
    const f1 = placed(ellipsoid(M(0.040), M(0.027), M(0.012), 10, 6), curl1, [0, k[1] + M(0.020) * Math.cos(curl1), k[2] + M(0.020) * Math.sin(curl1)]);
    const k2 = [0, k[1] + M(0.040) * Math.cos(curl1), k[2] + M(0.040) * Math.sin(curl1)];
    const f2 = placed(ellipsoid(M(0.037), M(0.024), M(0.011), 10, 6), curl2, [0, k2[1] + M(0.017) * Math.cos(curl2), k2[2] + M(0.017) * Math.sin(curl2)]);
    const thumb = placed(ellipsoid(M(0.012), M(0.034), M(0.012), 8, 6), -0.7, [-sideSign * M(0.045), M(0.045), M(-0.016)]);
    for (let i = 0; i < thumb.pos.length; i += 3) thumb.pos[i] += -sideSign * (thumb.pos[i + 1] - M(0.045)) * 0.35;
    return toGeometry(THREE, merged([palm, f1, f2, thumb]), skin);
  }
  seg.lHand = addPart(handGeometry(-1), "LH");
  seg.rHand = addPart(handGeometry(1), "RH");

  // ---- climbing shoes: ankle at the origin, toe toward -z (the wall), sole down ----
  function shoeGeometry() {
    const zToe = -DIM.toeFwd, zHeel = M(0.068), nR = 11;
    const part = loft(nR, 12, (j, phi) => {
      const v = j / (nR - 1);                         // 0 at the toe, 1 at the heel
      const z = zToe + (zHeel - zToe) * (0.5 - 0.5 * Math.cos(Math.PI * v));
      const round = Math.max(Math.pow(Math.sin(Math.PI * v), 0.5), 1e-3);
      const wide = M(0.047) * round * (0.82 + 0.18 * smooth(0.9, 0.3, v));
      const top = (M(0.026) + M(0.040) * smooth(0.1, 0.7, v)) * round;
      const bottom = M(0.021) * round;
      const yMid = M(-0.046) - M(0.010) * smooth(0.35, 0.0, v);   // the toe points slightly down
      const c = Math.cos(phi), s = Math.sin(phi);
      return [wide * s, yMid + (c > 0 ? top : bottom) * c, z];
    });
    return toGeometry(THREE, part, (x, y, z) => {
      const sole = y < M(-0.052) - M(0.006) * smooth(-0.02, -0.09, z);
      return sole ? [SOLE[0], SOLE[1], SOLE[2], 1, 0] : [SHOE[0], SHOE[1], SHOE[2], 1, 0.1];
    });
  }
  const shoeG = shoeGeometry();
  seg.lFoot = addPart(shoeG, "LF");
  seg.rFoot = addPart(shoeG, "RF");

  // ---- head: centre at the origin, face toward -z, top of the head toward +y ----
  const HEAD_R = [M(0.077), M(0.118), M(0.095)];
  const skull = ellipsoid(HEAD_R[0], HEAD_R[1], HEAD_R[2], 18, 12, (p, y, phi) => {
    const low = Math.max(-y, 0);
    p[0] *= 1 - 0.30 * low * low;                    // the jaw is narrower than the skull
    if (p[2] < 0) p[2] *= 0.94 - 0.12 * low;         // flatter face, chin tucked under
    else p[2] *= 1 + 0.06 * Math.max(y, 0) - 0.25 * low * low;
    p[2] += M(0.006);
    return p;
  });
  const nose = placed(ellipsoid(M(0.011), M(0.021), M(0.017), 8, 5), -0.25, [0, M(-0.012), -HEAD_R[2] * 0.93 + M(0.006)]);
  const earL = placed(ellipsoid(M(0.008), M(0.026), M(0.015), 8, 5), 0, [-HEAD_R[0] * 0.97, M(-0.004), M(0.012)]);
  const earR = placed(ellipsoid(M(0.008), M(0.026), M(0.015), 8, 5), 0, [HEAD_R[0] * 0.97, M(-0.004), M(0.012)]);
  seg.head = addPart(toGeometry(THREE, merged([skull, nose, earL, earR]), (x, y, z) => {
    // In the hologram a band at eye height glows in the accent colour, so you can see where the climber looks.
    const visor = z < -HEAD_R[2] * 0.25 && y > M(0.004) && y < M(0.042) ? 1 : 0;
    return [SKIN[0], SKIN[1], SKIN[2], visor, 0.1];
  }), "core");
  // Short hair, shown in the solid look only.
  const hair = placed(ellipsoid(M(0.082), M(0.100), M(0.097), 16, 9), 0.18, [0, M(0.030), M(0.019)]);
  seg.hair = addPart(toGeometry(THREE, hair, () => [HAIR[0], HAIR[1], HAIR[2], 0]), "core", { solidOnly: true });
  seg.head.add(seg.hair);

  seg.neck = addPart(toGeometry(THREE, limbShape(DIM.headUp - DIM.neckBase - M(0.05), [[0, M(0.054)], [1, M(0.049)]], 12, 3), skin), "core");

  // ---- chalk bag on the back of the hips ----
  const bagRings = [[-0.060, 0.004], [-0.056, 0.036], [-0.030, 0.050], [0.035, 0.052], [0.055, 0.055], [0.060, 0.047], [0.050, 0.040]];
  const bagPart = loft(bagRings.length, 12, (j, phi) => [M(bagRings[j][1]) * Math.cos(phi), M(bagRings[j][0]), M(bagRings[j][1]) * 0.8 * Math.sin(phi)]);
  seg.bag = addPart(toGeometry(THREE, bagPart, (x, y) => (y > M(0.046) ? [SOLE[0], SOLE[1], SOLE[2], 1, 0] : [BAG[0], BAG[1], BAG[2], 1, 0.2])), "core");

  // ---- trunk: rebuilt every frame from the hips and chest so it can bend and twist ----
  const torsoPart = loft(TORSO_RINGS.length, TORSO_SEG, () => [0, 0, 0]);
  const torsoG = toGeometry(THREE, torsoPart, (x, y, z, i) => {
    const s = TORSO_RINGS[Math.floor(i / TORSO_SEG)][0];
    if (s < 0.19) return shorts();
    if (s < 0.23) return [SOLE[0] * 2, SOLE[1] * 2, SOLE[2] * 2, 1, 0];  // waistband
    if (s < 1.03) return [SHIRT[0], SHIRT[1], SHIRT[2], 0, 1];
    return skin();
  });
  torsoG.attributes.position.setUsage(THREE.DynamicDrawUsage);
  torsoG.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  seg.torso = addPart(torsoG, "core");
  const cosT = [], sinT = [];
  for (let i = 0; i < TORSO_SEG; i++) {
    const phi = (i / TORSO_SEG) * Math.PI * 2, c = Math.cos(phi), s = Math.sin(phi);
    cosT.push(Math.sign(c) * Math.pow(Math.abs(c), 0.82)); sinT.push(Math.sign(s) * Math.pow(Math.abs(s), 0.82));
  }

  // ---- hologram only: a faint skeleton inside the body ----
  const BONES = [["pelvis", "chest"], ["chest", "neck"], ["neck", "head"], ["lShoulder", "rShoulder"], ["lHip", "rHip"],
    ["lShoulder", "lElbow"], ["lElbow", "lWrist"], ["rShoulder", "rElbow"], ["rElbow", "rWrist"],
    ["lHip", "lKnee"], ["lKnee", "lAnkle"], ["rHip", "rKnee"], ["rKnee", "rAnkle"]];
  const boneG = keep(new THREE.BufferGeometry());
  boneG.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const boneMat = keep(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  const bones = new THREE.LineSegments(boneG, boneMat);
  bones.frustumCulled = false; bones.renderOrder = 1000;
  group.add(bones);
  const JOINTS = ["lShoulder", "rShoulder", "lElbow", "rElbow", "lWrist", "rWrist", "lHip", "rHip", "lKnee", "rKnee", "lAnkle", "rAnkle", "chest", "pelvis"];
  const jointG = keep(new THREE.OctahedronGeometry(M(0.016), 0));
  const jointMat = keep(new THREE.MeshBasicMaterial({ color: colors.accent, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  const jointMeshes = JOINTS.map(() => { const m = new THREE.Mesh(jointG, jointMat); m.frustumCulled = false; m.renderOrder = 1000; group.add(m); return m; });

  // ---- soft light or shadow on the wall behind the body ----
  let glow = null, glowMat = null;
  if (options.wallGlow !== false) {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setAttribute("aMark", new THREE.BufferAttribute(new Float32Array(8), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    glowMat = keep(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0) }, uAlpha: { value: 0.3 } },
      vertexShader: VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false,
    }));
    glow = new THREE.Mesh(g, glowMat);
    glow.frustumCulled = false; glow.renderOrder = 990;
    group.add(glow);
  }

  // ---- state ----
  const state = { style: null, effort: 0, effortShown: 0, stable: true, strain: 0, movingLimb: null };
  let pose = null, time = 0, breath = 0;
  const soft = {};                                    // where each elbow and knee is drawn, trailing the pose a little

  function applyStyle(style) {
    state.style = style === "solid" ? "solid" : "hologram";
    const holo = state.style === "hologram";
    for (const p of parts) {
      p.mesh.material = holo ? mats[p.limb].holo : mats[p.limb].solid;
      p.mesh.renderOrder = holo ? 999 : 0;
      p.twin.visible = holo;
      if (p.solidOnly) p.mesh.visible = !holo;
    }
    bones.visible = holo;
    for (const j of jointMeshes) j.visible = holo;
    if (glowMat) {
      glowMat.blending = holo ? THREE.AdditiveBlending : THREE.NormalBlending;
      glowMat.needsUpdate = true;
    }
    applyColours();
  }

  const tmpColour = new THREE.Color();
  function applyColours() {
    effortColour(THREE, colors.calm, state.effortShown, tmpColour);
    shared.uBase.value.copy(tmpColour);
    shared.uTint.value.copy(tmpColour);
    shared.uTintAmount.value = 0.9 * smooth(0.25, 0.9, state.effortShown);
    shared.uRim.value.set(0x9fdcff).lerp(tmpColour, smooth(0.3, 0.9, state.effortShown));
    shared.uStrain.value = state.strain;
    if (glowMat) {
      if (state.style === "hologram") { glowMat.uniforms.uColor.value.copy(tmpColour); glowMat.uniforms.uAlpha.value = 0.20; }
      else { glowMat.uniforms.uColor.value.set(0x000000); glowMat.uniforms.uAlpha.value = 0.42; }
    }
  }

  // ---- placing the parts ----
  const _a = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  const _Y = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4();
  function between(mesh, a, b, nominal, H) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = _a.length() || 1e-6;
    _a.multiplyScalar(1 / L);
    mesh.position.set(a[0], a[1], a[2]);
    mesh.quaternion.setFromUnitVectors(_Y, _a);
    mesh.scale.set(H, L / nominal, H);
  }
  // Like between(), but also turned so the part's own +z points as close to "back" as it can.
  function betweenFacing(mesh, a, b, nominal, H, back) {
    const y = norm(sub(b, a)), z = norm(reject(back, y), [0, 0, 1]), x = cross(y, z);
    frame(mesh, a, x, y, z, H);
    mesh.scale.set(H, len(sub(b, a)) / nominal, H);
  }
  function frame(mesh, o, x, y, z, H) {
    _x.set(x[0], x[1], x[2]); _y.set(y[0], y[1], y[2]); _z.set(z[0], z[1], z[2]);
    _m.makeBasis(_x, _y, _z);
    mesh.quaternion.setFromRotationMatrix(_m);
    mesh.position.set(o[0], o[1], o[2]);
    mesh.scale.setScalar(H);
  }
  const dirOr = (v, fallback) => (v ? v : fallback);

  function updateTorso(P, C, rp, upP, rc, upC, H, breathe) {
    const arr = torsoG.attributes.position.array, L = len(sub(C, P));
    const bp = cross(rp, upP), bc = cross(rc, upC);
    for (let j = 0; j < TORSO_RINGS.length; j++) {
      const [s, w, d, zo] = TORSO_RINGS[j];
      const k = smooth(0.12, 0.88, s);
      const up = norm(mix(upP, upC, k));
      let r = norm(reject(mix(rp, rc, k), up));
      const b = cross(r, up);
      const c = s < 0 ? madd(P, upP, s * L) : (s > 1 ? madd(C, upC, (s - 1) * L) : mix(P, C, s));
      const chest = smooth(0.35, 0.7, s) * smooth(1.1, 0.9, s);
      const wj = w * H * (1 + 0.012 * breathe * chest), dj = d * H * (1 + 0.05 * breathe * chest);
      for (let i = 0; i < TORSO_SEG; i++) {
        const x = cosT[i] * wj, z = sinT[i] * dj * (sinT[i] < 0 ? 0.93 : 1.0) + zo * H, o = (j * TORSO_SEG + i) * 3;
        arr[o] = c[0] + r[0] * x + b[0] * z; arr[o + 1] = c[1] + r[1] * x + b[1] * z; arr[o + 2] = c[2] + r[2] * x + b[2] * z;
      }
    }
    torsoG.attributes.position.needsUpdate = true;
    torsoG.computeVertexNormals();
  }

  // Fill in whatever a pose from elsewhere leaves out.
  function completed(p) {
    if (p._complete) return p;
    const q = Object.assign({}, p);
    q.heightM = p.heightM || options.heightM || REF;
    const H = q.heightM;
    q.chestUp = dirOr(p.chestUp, norm(sub(p.chest, p.pelvis)));
    q.pelvisUp = dirOr(p.pelvisUp, q.chestUp);
    q.chestRight = dirOr(p.chestRight, norm(reject(sub(p.rShoulder, p.lShoulder), q.chestUp), [1, 0, 0]));
    q.pelvisRight = dirOr(p.pelvisRight, norm(reject(sub(p.rHip, p.lHip), q.pelvisUp), [1, 0, 0]));
    q.neck = p.neck || madd(p.chest, q.chestUp, DIM.neckBase * H);
    q.headForward = dirOr(p.headForward, mul(cross(q.chestRight, q.chestUp), -1));
    q.headUp = dirOr(p.headUp, norm(reject(q.chestUp, q.headForward)));
    for (const s of ["l", "r"]) {
      const hand = p[s + "Hand"], elbow = p[s + "Elbow"], foot = p[s + "Foot"];
      q[s + "HandDir"] = dirOr(p[s + "HandDir"], norm(sub(hand, elbow)));
      q[s + "HandBack"] = dirOr(p[s + "HandBack"], norm(reject([0, 0, 1], q[s + "HandDir"]), [0, 0, 1]));
      q[s + "Wrist"] = p[s + "Wrist"] || madd(madd(hand, q[s + "HandDir"], -DIM.grip * H), q[s + "HandBack"], DIM.palmOff * H);
      q[s + "FootBack"] = dirOr(p[s + "FootBack"], norm([0, 0.2, 1]));
      q[s + "FootUp"] = dirOr(p[s + "FootUp"], norm(reject([0, 1, 0], q[s + "FootBack"])));
      q[s + "Ankle"] = p[s + "Ankle"] || madd(madd(foot, q[s + "FootUp"], DIM.toeDown * H), q[s + "FootBack"], DIM.toeFwd * H);
    }
    q._complete = true;
    return q;
  }

  function place() {
    if (!pose) return;
    const p = pose, H = p.heightM, k = H / REF;

    // Small life-like motion. Hands and feet never move; only the body between them does.
    const br = Math.sin(breath);
    const sway = [0.004 * k * Math.sin(time * 0.83), 0.0015 * k * br, 0.004 * k * Math.sin(time * 0.61 + 1.3)];
    const shake = (seed) => {
      const a = 0.007 * k * state.strain;
      return [a * Math.sin(time * 61 + seed) * Math.sin(time * 7.3 + seed * 2), a * Math.sin(time * 53 + seed * 3) * Math.sin(time * 9.1 + seed), a * Math.sin(time * 47 + seed * 5) * 0.7];
    };
    const zero = [0, 0, 0];
    const shL = state.strain > 0.001 && state.movingLimb !== "LH" ? shake(1.7) : zero;
    const shR = state.strain > 0.001 && state.movingLimb !== "RH" ? shake(4.1) : zero;
    const trunk = add(mul(shL, 0.25), mul(shR, 0.25));

    const P = add(p.pelvis, sway), C = add(add(p.chest, mul(sway, 0.7)), trunk);
    const lS = add(add(p.lShoulder, mul(sway, 0.7)), add(trunk, mul(shL, 0.35)));
    const rS = add(add(p.rShoulder, mul(sway, 0.7)), add(trunk, mul(shR, 0.35)));
    lS[1] += 0.002 * k * br; rS[1] += 0.002 * k * br;
    // Elbows and knees swing toward where the pose wants them instead of snapping there.
    let eL = p.lElbow, eR = p.rElbow, kL = p.lKnee, kR = p.rKnee;
    if (p.targets) {
      for (const n of ["lElbow", "rElbow", "lKnee", "rKnee"]) if (!soft[n] || len(sub(soft[n], p[n])) > 0.5 * H) soft[n] = p[n].slice();
      const ua = DIM.upperArm * H, fa = DIM.foreArm * H, th = DIM.thigh * H, sh = DIM.shin * H;
      eL = twoBone(p.lShoulder, p.lWrist, ua, fa, sub(soft.lElbow, p.lShoulder), 0.042 * H, 1e9);
      eR = twoBone(p.rShoulder, p.rWrist, ua, fa, sub(soft.rElbow, p.rShoulder), 0.042 * H, 1e9);
      kL = twoBone(p.lHip, p.lAnkle, th, sh, sub(soft.lKnee, p.lHip), 0.055 * H, 1e9);
      kR = twoBone(p.rHip, p.rAnkle, th, sh, sub(soft.rKnee, p.rHip), 0.055 * H, 1e9);
    }
    const lE = add(add(eL, mul(sway, 0.35)), shL), rE = add(add(eR, mul(sway, 0.35)), shR);
    const lH = add(p.lHip, sway), rH = add(p.rHip, sway);
    const lK = add(kL, mul(sway, 0.5)), rK = add(kR, mul(sway, 0.5));
    const neck = add(add(p.neck, mul(sway, 0.7)), trunk);
    // The head turns toward its target instead of snapping there.
    if (!soft.look || dot(soft.look, p.headForward) < 0) soft.look = p.headForward.slice();
    const hf = norm(soft.look, p.headForward), hu = norm(reject(p.chestUp, hf), p.headUp);
    const head = add(madd(p.neck, norm(add(p.chestUp, hu)), (DIM.headUp - DIM.neckBase) * H), add(mul(sway, 0.7), mul(trunk, 0.8)));

    between(seg.lUpperArm, lS, lE, DIM.upperArm, H); between(seg.lForeArm, lE, p.lWrist, DIM.foreArm, H);
    between(seg.rUpperArm, rS, rE, DIM.upperArm, H); between(seg.rForeArm, rE, p.rWrist, DIM.foreArm, H);
    between(seg.lThigh, lH, lK, DIM.thigh, H); between(seg.rThigh, rH, rK, DIM.thigh, H);
    // The calf muscle sits behind the shin: on the side away from where the knee points.
    betweenFacing(seg.lCalf, lK, p.lAnkle, DIM.shin, H, sub(mix(lH, p.lAnkle, 0.5), lK));
    betweenFacing(seg.rCalf, rK, p.rAnkle, DIM.shin, H, sub(mix(rH, p.rAnkle, 0.5), rK));

    frame(seg.lHand, p.lWrist, cross(p.lHandDir, p.lHandBack), p.lHandDir, p.lHandBack, H);
    frame(seg.rHand, p.rWrist, cross(p.rHandDir, p.rHandBack), p.rHandDir, p.rHandBack, H);
    frame(seg.lFoot, p.lAnkle, cross(p.lFootUp, p.lFootBack), p.lFootUp, p.lFootBack, H);
    frame(seg.rFoot, p.rAnkle, cross(p.rFootUp, p.rFootBack), p.rFootUp, p.rFootBack, H);

    const hz = mul(hf, -1);
    frame(seg.head, head, cross(hu, hz), hu, hz, H);
    between(seg.neck, neck, madd(head, hu, -M(0.05) * H), DIM.headUp - DIM.neckBase - M(0.05), H);

    updateTorso(P, C, p.pelvisRight, p.pelvisUp, p.chestRight, p.chestUp, H, br);
    const pb = cross(p.pelvisRight, p.pelvisUp);
    frame(seg.bag, madd(madd(P, pb, M(0.152) * H), p.pelvisUp, M(0.0) * H), p.pelvisRight, p.pelvisUp, pb, H);

    if (state.style === "hologram") {
      const pts = { pelvis: P, chest: C, neck, head, lShoulder: lS, rShoulder: rS, lElbow: lE, rElbow: rE, lWrist: p.lWrist, rWrist: p.rWrist,
        lHip: lH, rHip: rH, lKnee: lK, rKnee: rK, lAnkle: p.lAnkle, rAnkle: p.rAnkle };
      const arr = boneG.attributes.position.array;
      BONES.forEach((b, i) => { arr.set(pts[b[0]], i * 6); arr.set(pts[b[1]], i * 6 + 3); });
      boneG.attributes.position.needsUpdate = true;
      JOINTS.forEach((n, i) => { const q = pts[n]; jointMeshes[i].position.set(q[0], q[1], q[2]); jointMeshes[i].scale.setScalar(H); });
    }
    if (glow) {
      const mid = mix(P, C, 0.5);
      glow.position.set(mid[0], mid[1], 0.004);
      glow.scale.set(0.62 * H, 0.82 * H, 1);
    }
  }

  function setPose(next) {
    if (!next) return;
    pose = completed(next);
    place();
  }

  function setState(next = {}) {
    if (next.effort !== undefined && next.effort !== null) state.effort = Math.max(0, +next.effort || 0);
    if (next.stable !== undefined) state.stable = next.stable !== false;
    if (next.movingLimb !== undefined) state.movingLimb = next.movingLimb || null;
    if (next.style !== undefined && next.style !== state.style) { applyStyle(next.style); place(); }
  }

  function update(dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    time += dt;
    breath += dt * (1.6 + 2.4 * clamp(state.effortShown, 0, 1));          // harder work, faster breathing
    shared.uTime.value = time;
    const q = Math.min(1, dt * 6);
    state.effortShown += (state.effort - state.effortShown) * q;
    state.strain += ((state.stable ? 0 : 1) - state.strain) * q;
    for (const name of LIMBS) {
      const want = name !== "core" && name === state.movingLimb ? 1 : 0;
      mats[name].uHighlight.value += (want - mats[name].uHighlight.value) * Math.min(1, dt * 8);
    }
    if (pose && pose.targets) {
      const f = 1 - Math.exp(-dt * 16);
      for (const n of ["lElbow", "rElbow", "lKnee", "rKnee"]) if (soft[n]) soft[n] = mix(soft[n], pose[n], f);
    }
    if (pose && soft.look) soft.look = norm(mix(soft.look, pose.headForward, 1 - Math.exp(-dt * 9)), pose.headForward);
    applyColours();
    place();
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const d of disposables) d.dispose();
  }

  applyStyle(options.style || "hologram");
  let triangles = 0;
  for (const p of parts) triangles += p.mesh.geometry.index.count / 3;

  return { group, setPose, setState, update, dispose, triangles, get style() { return state.style; } };
}
