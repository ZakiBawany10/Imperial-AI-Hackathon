// Shared wall model: every screen draws the same detected wall in a
// 1000 x 1000 coordinate space laid over the photo (xMidYMid slice).

export const C = {
  paper: "#F4EFE6",
  surface: "#FBF8F2",
  ink: "#1B1A17",
  muted: "#6B665C",
  hairline: "#D9D2C3",
  accent: "#E8431F",
  blue: "#2F6FDE",
  yellow: "#E8B100",
  green: "#2E8B57",
} as const;

export const HOLD_COLOURS: Record<string, string> = {
  blue: C.blue,
  yellow: C.yellow,
  green: C.green,
  red: C.accent,
  black: C.ink,
  white: C.surface,
};
// Colour group of a hold. Mock holds use the names above; real holds use
// groups made by lib/contract.ts from the detector's per-hold hex.
export type HoldColour = string;

export const HOLD_TYPES = ["jug", "crimp", "sloper", "pinch", "pocket", "volume", "foot"] as const;
export type HoldType = (typeof HOLD_TYPES)[number];

export const TYPE_INFO: Record<HoldType, { name: string; line: string }> = {
  jug: { name: "Jug", line: "deep, positive, wrap your whole hand" },
  crimp: { name: "Crimp", line: "thin edge, fingertips only" },
  sloper: { name: "Sloper", line: "rounded, relies on friction" },
  pinch: { name: "Pinch", line: "squeeze between thumb and fingers" },
  pocket: { name: "Pocket", line: "a hole for one to three fingers" },
  volume: { name: "Volume", line: "big wooden shape, use its edges" },
  foot: { name: "Foot chip", line: "tiny, for feet only" },
};

export type Hold = {
  id: string;
  x: number;
  y: number;
  r: number;
  colour: HoldColour;
  type: HoldType;
  tag: string;
  sx?: number;
  sy?: number;
  rot?: number;
  /** Real holds carry their own display colour (the group's average hex). */
  hex?: string;
  guesses?: [HoldType, number][];
  added?: boolean;
};

const h = (
  id: string,
  x: number,
  y: number,
  r: number,
  colour: HoldColour,
  type: HoldType,
  tag: string,
  extra: Partial<Hold> = {},
): Hold => ({ id, x, y, r, colour, type, tag, ...extra });

export const HOLDS: Hold[] = [
  // the blue problem
  h("y1", 430, 700, 24, "blue", "jug", "A1", { sx: 1.3, rot: -10 }),
  h("y2", 545, 655, 21, "blue", "jug", "A2", { sx: 1.2, rot: 15 }),
  h("y3", 385, 545, 15, "blue", "crimp", "A3", {
    sx: 1.7,
    sy: 0.7,
    rot: -6,
    guesses: [
      ["crimp", 61],
      ["jug", 22],
      ["pinch", 9],
    ],
  }),
  h("yA", 415, 470, 18, "blue", "pinch", "C2", {
    sx: 0.7,
    sy: 1.5,
    rot: 12,
    guesses: [
      ["jug", 48],
      ["pinch", 31],
      ["sloper", 12],
    ],
  }),
  h("y9", 520, 545, 12, "blue", "crimp", "B2", { sx: 1.5, sy: 0.7 }),
  h("y4", 565, 450, 27, "blue", "sloper", "B4", { sx: 1.25, rot: -20 }),
  h("y5", 440, 365, 16, "blue", "crimp", "C4", { sx: 1.6, sy: 0.75, rot: 8 }),
  h("y6", 615, 285, 19, "blue", "pocket", "D3", {
    guesses: [
      ["pocket", 58],
      ["crimp", 24],
      ["jug", 11],
    ],
  }),
  h("y7", 485, 200, 21, "blue", "jug", "D5", { sx: 1.3, rot: -25 }),
  h("y8", 590, 115, 27, "blue", "jug", "TOP", { sx: 1.35, rot: 10 }),
  h("f1", 400, 900, 10, "blue", "foot", "F1"),
  h("f2", 565, 885, 10, "blue", "foot", "F2"),
  h("f3", 455, 790, 9, "blue", "foot", "F3"),
  h("f4", 610, 770, 10, "blue", "foot", "F4"),
  // everything else on the wall
  h("n1", 190, 820, 26, "yellow", "jug", "E1", { sx: 1.3 }),
  h("n2", 255, 690, 20, "green", "crimp", "E2", { sx: 1.6, sy: 0.7 }),
  h("n3", 730, 860, 30, "red", "sloper", "G1"),
  h("n4", 800, 720, 17, "black", "crimp", "G2", { sx: 1.5, sy: 0.8 }),
  h("n5", 295, 560, 24, "yellow", "jug", "E3", {
    guesses: [
      ["jug", 52],
      ["sloper", 30],
      ["pinch", 10],
    ],
  }),
  h("n6", 715, 600, 26, "green", "jug", "G3", { sx: 1.2, rot: 30 }),
  h("n7", 195, 420, 19, "white", "pocket", "E4"),
  h("n8", 765, 470, 22, "red", "pinch", "G4", { sy: 1.4 }),
  h("n9", 300, 300, 26, "green", "sloper", "E5", {
    sx: 1.3,
    guesses: [
      ["sloper", 55],
      ["jug", 25],
      ["volume", 8],
    ],
  }),
  h("n10", 720, 380, 23, "yellow", "crimp", "G5", { sx: 1.6, sy: 0.8, rot: -15 }),
  h("n11", 185, 215, 15, "black", "crimp", "E6"),
  h("n12", 335, 150, 23, "red", "jug", "E7", { sx: 1.3 }),
  h("n13", 765, 205, 20, "green", "pinch", "G6", { sy: 1.4, rot: 20 }),
  h("n14", 690, 120, 21, "yellow", "jug", "G7"),
  h("n15", 840, 300, 15, "white", "crimp", "H5"),
  h("n16", 255, 885, 17, "red", "foot", "E0"),
  h("n17", 850, 610, 55, "white", "volume", "H3", { sx: 1.2, sy: 1.1, rot: 8 }),
  h("n18", 150, 600, 50, "white", "volume", "E9", { sx: 0.9, sy: 1.25 }),
];

export const UNSURE_ORDER = ["y3", "n5", "yA", "n9", "y6"];
export const ROUTE_COLOUR: HoldColour = "blue";
export const holdById = (id: string) => HOLDS.find((x) => x.id === id)!;

/* ---------- organic hold outlines ---------- */
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function seedOf(id: string) {
  let s = 7;
  for (const ch of id) s = (s * 31 + ch.charCodeAt(0)) % 100000;
  return s + 1;
}
export function holdPath(hold: Hold, scale = 1, n = 9) {
  const rand = rng(seedOf(hold.id) * 97);
  const sx = hold.sx ?? 1;
  const sy = hold.sy ?? 1;
  const rot = ((hold.rot ?? 0) * Math.PI) / 180;
  const r = hold.r * scale;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.8 + rand() * 0.34);
    const x = Math.cos(a) * rr * sx;
    const y = Math.sin(a) * rr * sy;
    pts.push([
      hold.x + x * Math.cos(rot) - y * Math.sin(rot),
      hold.y + x * Math.sin(rot) + y * Math.cos(rot),
    ]);
  }
  const p = (i: number) => pts[(i + n) % n];
  let d = `M${p(0)[0].toFixed(1)} ${p(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + "Z";
}

/* ---------- beta: sequences by climber height ---------- */
export type Limb = "LH" | "RH" | "LF" | "RF";
export type Move = { limbs: Partial<Record<Limb, string>>; text: string };
export const START: Record<Limb, string> = { LH: "y1", RH: "y2", LF: "f1", RF: "f2" };

const M = {
  m1: { limbs: { LH: "y3" }, text: "left hand up to the crimp A3. Keep your hips close." },
  m1t: { limbs: { LH: "yA" }, text: "left hand reaches straight to the pinch C2." },
  m2: { limbs: { RF: "f4" }, text: "right foot steps high onto the edge by your knee." },
  m3: { limbs: { LH: "yA" }, text: "left hand bumps to the pinch C2. Squeeze hard." },
  m4: {
    limbs: { RH: "y4", LF: "f3" },
    text: "right hand to the sloper B4 while left foot steps up.",
  },
  m4s: {
    limbs: { RH: "y9", LF: "f3" },
    text: "right hand to the crimp B2 while left foot steps up.",
  },
  m4b: { limbs: { RH: "y4" }, text: "right hand bumps to the sloper B4. Stay low on it." },
  m5: { limbs: { RF: "y2" }, text: "right foot rocks over onto the start jug A2." },
  m6: {
    limbs: { LH: "y5", LF: "y1" },
    text: "left hand to the crimp C4 as left foot comes up to A1.",
  },
  m7: { limbs: { RH: "y6" }, text: "right hand to the pocket D3. Two fingers, thumb on top." },
  m8: { limbs: { LH: "y7", RF: "y9" }, text: "left hand to the jug D5, right foot onto B2." },
  m9: { limbs: { RH: "y8" }, text: "right hand to the finish jug. Match and hold." },
} satisfies Record<string, Move>;

export type Beta = { moves: Move[]; crux: number; grade: string; v: string; band: string };
export function betaFor(height: number): Beta {
  if (height < 1.62)
    return {
      band: "short",
      moves: [M.m1, M.m2, M.m3, M.m4s, M.m4b, M.m5, M.m6, M.m7, M.m8, M.m9],
      crux: 5,
      grade: "6a+",
      v: "V3",
    };
  if (height > 1.86)
    return {
      band: "tall",
      moves: [M.m1t, M.m2, M.m4, M.m5, M.m6, M.m7, M.m8, M.m9],
      crux: 3,
      grade: "5c+",
      v: "V2",
    };
  return {
    band: "mid",
    moves: [M.m1, M.m2, M.m3, M.m4, M.m5, M.m6, M.m7, M.m8, M.m9],
    crux: 4,
    grade: "6a",
    v: "V3",
  };
}
export const GRADE_RANGE = "Range 5c+ to 6a+";

export type Pt = { x: number; y: number };
export type Placement = Record<Limb, Pt>;
export function placements(moves: Move[]): Placement[] {
  let cur = { ...START };
  const at = (s: Record<Limb, string>): Placement => {
    const o = {} as Placement;
    for (const k of Object.keys(s) as Limb[]) {
      const hh = holdById(s[k]);
      o[k] = { x: hh.x, y: hh.y };
    }
    return o;
  };
  const out = [at(cur)];
  for (const m of moves) {
    cur = { ...cur, ...(m.limbs as Record<Limb, string>) };
    out.push(at(cur));
  }
  return out;
}

const lerp = (a: Pt, b: Pt, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function placementAt(list: Placement[], t: number): Placement {
  const i = Math.max(0, Math.min(list.length - 1, Math.floor(t)));
  const j = Math.min(list.length - 1, i + 1);
  const f = ease(Math.max(0, Math.min(1, t - i)));
  const o = {} as Placement;
  for (const k of ["LH", "RH", "LF", "RF"] as Limb[]) o[k] = lerp(list[i][k], list[j][k], f);
  return o;
}

/** Stick-figure skeleton from four contact points. `H` is body height in wall units. */
export function skeleton(p: Placement, H: number) {
  const avg = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const hands = avg(p.LH, p.RH);
  const feet = avg(p.LF, p.RF);
  const hip = lerp(feet, hands, 0.4);
  const dx = hands.x - hip.x;
  const dy = hands.y - hip.y;
  const len = Math.hypot(dx, dy) || 1;
  const torso = 0.3 * H;
  const neck = { x: hip.x + (dx / len) * torso, y: hip.y + (dy / len) * torso };
  const head = { x: neck.x + (dx / len) * 0.1 * H, y: neck.y + (dy / len) * 0.1 * H - 0.02 * H };
  const sh = 0.11 * H;
  const hp = 0.06 * H;
  const shL = { x: neck.x - sh, y: neck.y + 4 };
  const shR = { x: neck.x + sh, y: neck.y + 4 };
  const hipL = { x: hip.x - hp, y: hip.y };
  const hipR = { x: hip.x + hp, y: hip.y };
  const joint = (a: Pt, b: Pt, seg: number, side: -1 | 1) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const m = avg(a, b);
    if (d >= seg * 2) return m;
    const k = Math.sqrt(seg * seg - (d / 2) ** 2);
    let nx = -(b.y - a.y) / (d || 1);
    let ny = (b.x - a.x) / (d || 1);
    if (Math.sign(nx) !== side) {
      nx = -nx;
      ny = -ny;
    }
    return { x: m.x + nx * k, y: m.y + ny * k };
  };
  const arm = 0.2 * H;
  const leg = 0.26 * H;
  return {
    head,
    headR: 0.065 * H,
    neck,
    hip,
    shL,
    shR,
    hipL,
    hipR,
    elL: joint(shL, p.LH, arm, -1),
    elR: joint(shR, p.RH, arm, 1),
    knL: joint(hipL, p.LF, leg, -1),
    knR: joint(hipR, p.RF, leg, 1),
    ...p,
  };
}

export const PHOTOS = {
  wall01: "1696105538708-6be6c90707a1",
  wall02: "1659666287295-7da26c3f80d4",
  wall03: "1788247356784-dc09fba8ac0e",
};
export const unsplash = (id: string, w = 1200) =>
  `https://images.unsplash.com/photo-${id}?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=80&w=${w}`;

const LADDER = ["5a", "5b", "5c", "5c+", "6a", "6a+", "6b", "6b+", "6c", "7a"];
const V = ["V0", "V1", "V2", "V2", "V3", "V3", "V4", "V4", "V5", "V6"];
export const ANGLE_OFFSET: Record<string, number> = { slab: -1, vertical: 0, "10": 1, "30": 2 };
/** Grade for a climber height on a given wall angle. */
export function gradeFor(height: number, angle = "vertical") {
  const b = betaFor(height);
  const i = Math.max(
    0,
    Math.min(LADDER.length - 1, LADDER.indexOf(b.grade) + (ANGLE_OFFSET[angle] ?? 0)),
  );
  const lo = LADDER[Math.max(0, i - 1)];
  const hi = LADDER[Math.min(LADDER.length - 1, i + 1)];
  return { grade: LADDER[i], v: V[i], range: `Range ${lo} to ${hi}` };
}
