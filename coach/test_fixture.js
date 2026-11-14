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

// A route whose moves mix hands and feet, the shape Krishna's solver will return
// once it adds foot moves. Same photo and wall as above (360 px per metre).
// Moves 3 and 6 are feet on the wall rather than a hold: the contract doesn't say
// yet how those appear, so one uses `hold: null` and the other has no `hold` at
// all. Move 5 points at a hold id that isn't in the request.
const P = (lh, rh, lf, rf) => ({ head: [620, 950], hip: [620, 1250], lh, rh, lf, rf });
const mixedPoses = [
  P([540, 1100], [700, 1080], [580, 1400], [660, 1400]), // start
  P([540, 1100], [700, 1080], [580, 1400], [680, 1260]), // 0 RF up to foothold 40
  P([540, 1100], [760, 900], [580, 1400], [680, 1260]), //  1 RH to crimp 12
  P([540, 1100], [760, 900], [590, 1220], [680, 1260]), //  2 LF up to foothold 41
  P([540, 1100], [760, 900], [590, 1220], [700, 1110]), //  3 RF up onto the wall (hold: null)
  P([560, 760], [760, 900], [590, 1220], [700, 1110]), //   4 LH to sloper 15 (crux)
  P([560, 760], [760, 900], [600, 1060], [700, 1110]), //   5 LF up to hold 99 (not in request)
  P([560, 760], [760, 900], [600, 1060], [720, 960]), //    6 RF up onto the wall (no hold key)
  P([560, 760], [900, 560], [600, 1060], [720, 960]), //    7 RH to jug 22
  P([900, 560], [900, 560], [600, 1060], [720, 960]), //    8 LH matches on 22
];

export const fixtureMixedRequest = {
  ...fixtureRequest,
  holds: [
    ...fixtureRequest.holds,
    { id: 40, x: 680, y: 1260, w: 30, h: 20, type: "foot", quality: 0.4, color: "#2050c0", score: 0.6, needs_review: false, suggestions: [] },
    { id: 41, x: 590, y: 1220, w: 30, h: 20, type: "foot", quality: 0.4, color: "#2050c0", score: 0.6, needs_review: false, suggestions: [] },
  ],
};

export const fixtureMixedSolve = {
  grade: fixtureSolve.grade,
  crux: 4,
  moves: [
    { i: 0, limb: "RF", hold: 40 },
    { i: 1, limb: "RH", hold: 12 },
    { i: 2, limb: "LF", hold: 41 },
    { i: 3, limb: "RF", hold: null },
    { i: 4, limb: "LH", hold: 15 },
    { i: 5, limb: "LF", hold: 99 },
    { i: 6, limb: "RF" },
    { i: 7, limb: "RH", hold: 22 },
    { i: 8, limb: "LH", hold: 22 },
  ],
  keyframes: mixedPoses.map((joints, move) => ({ move, joints })),
};
