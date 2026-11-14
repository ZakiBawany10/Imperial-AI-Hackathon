// Test data only, written in the shape of the API contract in Documents/PLAN.md.
// This is NOT a substitute for contract/solve.json: the tests and try_coach.mjs
// use the real contract files when they exist and fall back to this otherwise.
//
// 1440 px tall photo of a 4.0 m wall, so 360 px per metre.

export const fixtureRequest = {
  image: { w: 1920, h: 1440 },
  holds: [
    { id: 3, x: 540, y: 1100, w: 60, h: 50, type: "jug", quality: 0.9, color: "#2050c0", score: 0.8, needs_review: false, suggestions: [] },
    { id: 7, x: 700, y: 1080, w: 50, h: 40, type: "jug", quality: 0.9, color: "#2050c0", score: 0.8, needs_review: false, suggestions: [] },
    { id: 12, x: 760, y: 900, w: 50, h: 20, type: "crimp", quality: 0.3, color: "#2050c0", score: 0.7, needs_review: false, suggestions: [] },
    { id: 15, x: 560, y: 760, w: 80, h: 60, type: "sloper", quality: 0.25, color: "#2050c0", score: 0.6, needs_review: false, suggestions: [] },
    { id: 22, x: 900, y: 560, w: 70, h: 60, type: "jug", quality: 0.9, color: "#2050c0", score: 0.9, needs_review: false, suggestions: [] },
  ],
  start: [3, 7],
  finish: [22],
  climber_height_m: 1.75,
  wall_height_m: 4.0,
  wall_angle_deg: 0,
};

const pose = (lh, rh) => ({
  head: [620, 950], hip: [620, 1250],
  lh, rh, l_elbow: [560, 1150], r_elbow: [690, 1140],
  lf: [580, 1400], rf: [660, 1400], l_knee: [590, 1330], r_knee: [650, 1330],
});

export const fixtureSolve = {
  grade: { font: "6a", v: "V3", low: "5c", high: "6a+" },
  crux: 1,
  moves: [
    { i: 0, limb: "RH", hold: 12, load: 0.42, span_m: 0.5 },
    { i: 1, limb: "LH", hold: 15, load: 0.55, span_m: 0.9 },
    { i: 2, limb: "RH", hold: 22, load: 0.4, span_m: 1.0 },
    { i: 3, limb: "LH", hold: 22, load: 0.3, span_m: 0.0 },
  ],
  keyframes: [
    { move: 0, joints: pose([540, 1100], [700, 1080]) },
    { move: 1, joints: pose([540, 1100], [760, 900]) },
    { move: 2, joints: pose([560, 760], [760, 900]) },
    { move: 3, joints: pose([560, 760], [900, 560]) },
    { move: 4, joints: pose([900, 560], [900, 560]) },
  ],
};

export const fixtureHoldTypes = [
  { id: "jug", name: "Jug", quality: 0.9 },
  { id: "crimp", name: "Crimp", quality: 0.3 },
  { id: "sloper", name: "Sloper", quality: 0.25 },
];
