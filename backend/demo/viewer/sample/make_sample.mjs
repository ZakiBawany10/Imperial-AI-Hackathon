// Builds the hand-made test sample in this folder. Run:  node make_sample.mjs
//
// It starts from the real examples in contract/ (same photo, same yellow route) and adds the
// fields the API is planned to get: foot moves, contacts, forces, centre of mass, effort, hold
// outlines, colour names and routes. The sequence of positions below was written by hand, and
// the force numbers come from a toy balance calculation in this file. They are NOT from the real
// physics engine: they exist only so the 3D viewer can be tested before that engine lands.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contract = join(here, "..", "..", "..", "..", "contract");
const read = (name) => JSON.parse(readFileSync(join(contract, name), "utf8"));
const analyze = read("analyze.json"), request = read("solve_request.json"), solved = read("solve.json");

// ---------- /analyze additions: outline, color_name, route, routes ----------

function rng(seed) {                       // small repeatable random number generator
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function outline(h) {                      // a lumpy closed shape that fits the hold's box
  const rand = rng(h.id * 7919 + 13), n = 12, pts = [];
  const lump = Array.from({ length: n }, () => 0.84 + 0.2 * rand());
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3 * (rand() - 0.5) / n;
    const c = Math.cos(a), s = Math.sin(a);
    const r = Math.pow(Math.pow(Math.abs(c), 2.6) + Math.pow(Math.abs(s), 2.6), -1 / 2.6) * (lump[i] + lump[(i + 1) % n]) / 2;
    pts.push([Math.round(h.x + c * r * h.w / 2), Math.round(h.y + s * r * h.h / 2)]);
  }
  return pts;
}

function colorName(hex) {
  const v = parseInt(hex.slice(1), 16), r = (v >> 16) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d < 0.12) return l > 0.8 ? "white" : l < 0.22 ? "black" : "grey";
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 340) return l > 0.62 ? "pink" : "red";
  if (hue < 40) return l < 0.42 ? "brown" : "orange";
  if (hue < 70) return "yellow";
  if (hue < 165) return "green";
  if (hue < 255) return "blue";
  if (hue < 290) return "purple";
  return "pink";
}

const ROUTE_HEX = { red: "#e5383b", pink: "#ff6fae", orange: "#f48c06", yellow: "#f4d03f", green: "#52b788",
                    blue: "#3a86ff", purple: "#9d4edd", white: "#f1f1f1", black: "#2b2b2b", brown: "#8d6e53" };
const routes = [];
for (const h of analyze.holds) {
  h.outline = outline(h);
  h.color_name = colorName(h.color);
  if (h.color_name === "grey") { h.route = null; continue; }     // no clear colour: belongs to no route
  let k = routes.findIndex((r) => r.color_name === h.color_name);
  if (k < 0) k = routes.push({ id: routes.length, color: ROUTE_HEX[h.color_name], color_name: h.color_name, holds: [] }) - 1;
  routes[k].holds.push(h.id);
  h.route = k;
}
analyze.routes = routes;

// ---------- /solve request: the same yellow route, on a wall that overhangs by 12 degrees ----------

const byId = new Map(analyze.holds.map((h) => [h.id, h]));
for (const h of request.holds) Object.assign(h, { outline: byId.get(h.id).outline, color_name: "yellow", route: byId.get(h.id).route });
request.wall_angle_deg = 12;
request.limbs = "all";

// ---------- /solve response with foot moves and physics ----------

const hold = new Map(request.holds.map((h) => [h.id, h]));
const H = request.climber_height_m / (request.wall_height_m / request.image.h);    // climber height in pixels
// Body proportions, the same shares of height that backend/pose.py uses.
const ARM_UPPER = 0.25, ARM_FORE = 0.265, HEAD = 0.11, TORSO = 0.29, THIGH = 0.245, SHIN = 0.26;

// Each position: which hold every hand and foot is on (a number is a hold id, [x, y] is a spot
// on the bare wall) and where the hips are. The first is the start; each later one follows a move.
const W = (x, y) => [x, y];
const positions = [
  { LH: 176, RH: 166, LF: W(150, 1436), RF: W(350, 1436), hip: [261, 1300] },
  { LH: 166, RH: 166, LF: W(150, 1436), RF: W(350, 1436), hip: [345, 1290], limb: "LH" },
  { LH: 166, RH: 166, LF: 176,          RF: W(350, 1436), hip: [330, 1285], limb: "LF" },
  { LH: 166, RH: 166, LF: 176,          RF: W(430, 1290), hip: [335, 1255], limb: "RF" },
  { LH: 166, RH: 53,  LF: 176,          RF: W(430, 1290), hip: [355, 1010], limb: "RH" },
  { LH: 106, RH: 53,  LF: 176,          RF: W(430, 1290), hip: [325, 1000], limb: "LH" },
  { LH: 106, RH: 53,  LF: 176,          RF: 166,          hip: [290, 965],  limb: "RF" },
  { LH: 106, RH: 53,  LF: 146,          RF: 166,          hip: [330, 783],  limb: "LF" },
  { LH: 106, RH: 53,  LF: 146,          RF: W(390, 890),  hip: [320, 700],  limb: "RF" },
  { LH: 2,   RH: 53,  LF: 146,          RF: W(390, 890),  hip: [285, 603],  limb: "LH" },
];
const LIMBS = ["LH", "RH", "LF", "RF"];
const idOf = (c) => (typeof c === "number" ? c : null);

function spot(p, limb) {                    // pixel position of a hand or foot
  const c = p[limb];
  if (typeof c !== "number") return c;
  const h = hold.get(c);
  if (limb === "LH" || limb === "RH") {
    if (p.LH === p.RH) {                    // both hands on one hold sit side by side
      const off = Math.min(h.w / 4, 0.04 * H);
      return [h.x + (limb === "LH" ? -off : off), h.y];
    }
  }
  return [h.x, h.y];
}

function twoBone(root, target, l1, l2, prefer) {   // elbow or knee between two ends (as in pose.py)
  const dx = target[0] - root[0], dy = target[1] - root[1];
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) return [root[0], root[1] + l1];
  const ux = dx / d, uy = dy / d;
  const shrink = Math.min(1, Math.max(d / (0.85 * (l1 + l2)), 0.45));
  l1 *= shrink; l2 *= shrink;
  if (d >= l1 + l2) { const t = l1 / (l1 + l2); return [root[0] + dx * t, root[1] + dy * t]; }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-6);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), hgt = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const px = root[0] + ux * a, py = root[1] + uy * a;
  const opts = [[px - uy * hgt, py + ux * hgt], [px + uy * hgt, py - ux * hgt]];
  return prefer(opts[0]) >= prefer(opts[1]) ? opts[0] : opts[1];
}

function joints(p) {
  const hip = p.hip, head = [hip[0], hip[1] - (HEAD + TORSO) * H], neck = [hip[0], hip[1] - TORSO * H];
  const lh = spot(p, "LH"), rh = spot(p, "RH"), lf = spot(p, "LF"), rf = spot(p, "RF");
  for (const [name, a, b, reach] of [["LH", neck, lh, ARM_UPPER + ARM_FORE], ["RH", neck, rh, ARM_UPPER + ARM_FORE],
                                     ["LF", hip, lf, THIGH + SHIN], ["RF", hip, rf, THIGH + SHIN]]) {
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) / H;
    if (d > reach * 1.01) throw new Error(`position ${positions.indexOf(p)}: ${name} is out of reach (${d.toFixed(3)} > ${reach})`);
  }
  const j = {
    head, hip, lh, rh,
    l_elbow: twoBone(neck, lh, ARM_UPPER * H, ARM_FORE * H, (q) => -q[0] + 0.5 * q[1]),
    r_elbow: twoBone(neck, rh, ARM_UPPER * H, ARM_FORE * H, (q) => q[0] + 0.5 * q[1]),
    lf, rf,
    l_knee: twoBone(hip, lf, THIGH * H, SHIN * H, (q) => -q[0] - 0.3 * q[1]),
    r_knee: twoBone(hip, rf, THIGH * H, SHIN * H, (q) => q[0] - 0.3 * q[1]),
  };
  for (const k of Object.keys(j)) j[k] = [Math.round(j[k][0]), Math.round(j[k][1])];
  return j;
}

function centreOfMass(j) {                  // weighted average of body parts
  const neck = [j.head[0] + 0.275 * (j.hip[0] - j.head[0]), j.head[1] + 0.275 * (j.hip[1] - j.head[1])];
  const parts = [[j.head, 0.08], [[(neck[0] + j.hip[0]) / 2, (neck[1] + j.hip[1]) / 2], 0.5],
                 [j.l_elbow, 0.05], [j.r_elbow, 0.05], [j.l_knee, 0.16], [j.r_knee, 0.16]];
  return [parts.reduce((s, [q, w]) => s + q[0] * w, 0), parts.reduce((s, [q, w]) => s + q[1] * w, 0)];
}

// Toy balance: forces at the contact points that add up to one body-weight upward and do not
// turn the body about its centre of mass, spread as evenly as the weights allow (feet are cheap
// to load, hands are expensive, a foot on the bare wall most of all because it only sticks by
// friction). A limb that would have to pull the body downward is dropped.
function balance(points, com) {             // points: [{limb, at:[x,y], cost}] -> [{limb, at, f:[fx,fy], share}]
  let active = points.slice();
  for (;;) {
    const n = active.length, cost = active.map((q) => q.cost);
    // Unknowns u = (fx_i, fy_i) with y up. Rows: sum fx = 0, sum fy = 1, sum (rx*fy - ry*fx) = 0.
    const A = [new Array(2 * n).fill(0), new Array(2 * n).fill(0), new Array(2 * n).fill(0)];
    active.forEach((q, i) => {
      const rx = (q.at[0] - com[0]) / H, ry = -(q.at[1] - com[1]) / H;
      A[0][2 * i] = 1; A[1][2 * i + 1] = 1; A[2][2 * i] = -ry; A[2][2 * i + 1] = rx;
    });
    const wInv = (k) => 1 / (cost[k >> 1] * (k % 2 === 0 ? 3 : 1));   // sideways force costs three times more
    const M = A.map((ra) => A.map((rb) => ra.reduce((s, v, k) => s + v * wInv(k) * rb[k], 0)));
    const lam = solve3(M, [0, 1, 0]);
    const u = new Array(2 * n).fill(0).map((_, k) => wInv(k) * (A[0][k] * lam[0] + A[1][k] * lam[1] + A[2][k] * lam[2]));
    const worst = active.map((q, i) => [u[2 * i + 1], i]).filter(([fy]) => fy < -1e-6).sort((a, b) => a[0] - b[0])[0];
    if (worst && n > 1) { active.splice(worst[1], 1); continue; }
    const total = active.reduce((s, q, i) => s + Math.hypot(u[2 * i], u[2 * i + 1]), 0);
    return active.map((q, i) => ({
      limb: q.limb, at: q.at.map(Math.round),
      f: [+u[2 * i].toFixed(3), +(-u[2 * i + 1]).toFixed(3)],        // back to photo axes: y down
      share: +(Math.hypot(u[2 * i], u[2 * i + 1]) / total).toFixed(3),
    }));
  }
}

function solve3(M, b) {                     // 3 x 3 linear system by Gaussian elimination
  const a = M.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const k = a[r][c] / a[c][c]; for (let q = c; q < 4; q++) a[r][q] -= k * a[c][q]; }
  }
  return a.map((row, i) => row[3] / row[i]);
}

// Effort: the hardest-working hand's force, divided by what that hand can hold on its hold.
// A hand on a perfect hold is taken to hold 1.1 body-weights; a worse hold scales that down.
const GRIP = Number(process.env.GRIP || 0.5);
const loadCost = (p, limb) => {
  if (limb[1] === "H") return 2.2;
  if (typeof p[limb] === "number") return 1;                 // a foot on a hold
  return p[limb][1] > request.image.h - 10 ? 0.3 : 4;        // a foot on the floor, or on the bare wall
};
function effort(forces, p) {
  let e = 0;
  for (const f of forces) {
    if (f.limb[1] !== "H") continue;
    const q = hold.get(p[f.limb])?.quality ?? 0.5;
    e = Math.max(e, Math.hypot(f.f[0], f.f[1]) / (GRIP * (0.35 + 0.65 * q)));
  }
  return +e.toFixed(2);
}

const keyframes = [], moves = [];
positions.forEach((p, k) => {
  const j = joints(p), com = centreOfMass(j);
  const forces = balance(LIMBS.map((limb) => ({ limb, at: spot(p, limb), cost: loadCost(p, limb) })), com);
  const e = effort(forces, p);
  keyframes.push({
    move: k, joints: j,
    contacts: { LH: p.LH, RH: p.RH, LF: idOf(p.LF), RF: idOf(p.RF) },
    physics: { com: com.map(Math.round), effort: e, stable: e < 1, forces },
  });
  if (k === 0) return;
  // While the limb is in the air the other three hold the position the climber is leaving.
  const before = positions[k - 1], jb = joints(before);
  const others = LIMBS.filter((l) => l !== p.limb).map((limb) => ({ limb, at: spot(before, limb), cost: loadCost(before, limb) }));
  // The body has already shifted half way toward the new position when the limb lets go.
  const cb = centreOfMass(jb), mid = [(cb[0] + com[0]) / 2, (cb[1] + com[1]) / 2];
  const em = effort(balance(others, mid), before);
  const from = spot(before, p.limb), to = spot(p, p.limb);
  moves.push({
    i: k - 1, limb: p.limb, hold: idOf(p[p.limb]),
    load: +Math.min(1, em * 0.6).toFixed(2),
    span_m: +(Math.hypot(to[0] - from[0], to[1] - from[1]) * request.wall_height_m / request.image.h).toFixed(2),
    effort: em, stable: em < 1,
  });
});

const efforts = moves.map((m) => m.effort);
const out = {
  grade: solved.grade,
  crux: efforts.indexOf(Math.max(...efforts)),
  moves, keyframes,
  physics: {
    model: "static-2.5d",
    max_effort: Math.max(...efforts),
    mean_effort: +(efforts.reduce((s, v) => s + v, 0) / efforts.length).toFixed(2),
    unstable_positions: moves.filter((m) => !m.stable).length,
  },
};

writeFileSync(join(here, "analyze.json"), JSON.stringify(analyze));
writeFileSync(join(here, "solve_request.json"), JSON.stringify(request, null, 1));
writeFileSync(join(here, "solve.json"), JSON.stringify(out, null, 1));
console.log("routes:", routes.map((r) => `${r.color_name} ${r.holds.length}`).join(", "));
for (const m of moves) console.log(`move ${m.i}: ${m.limb} -> ${m.hold}  effort ${m.effort}  stable ${m.stable}  span ${m.span_m} m`);
console.log("crux", out.crux, out.physics);
for (const k of keyframes) console.log(k.move, "effort", k.physics.effort, k.physics.forces.map((f) => `${f.limb} ${f.f} ${f.share}`).join(" | "));
