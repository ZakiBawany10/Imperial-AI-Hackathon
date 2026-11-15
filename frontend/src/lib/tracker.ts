// Live camera: follow the climber on the phone's video and tell the app when each move is done.
//
// Set-up: the phone stays where it took the wall photo (a tripod, or leaning on a bag), so a point
// on the video is the same point on the photo. The live view shows the photo faintly over the
// video to line the two up. A pose model (MediaPipe Pose Landmarker, in the browser) finds the
// climber's fingertips and toes in every frame; a move is done when a hand (or foot, for a foot
// move) arrives on the move's hold and stays there a moment.
//
// Seen from behind, the model can mix up left and right, so either hand counts for a hand move and
// either foot for a foot move. A limb only counts once it has been off the hold since the move
// began, so a hand already on the hold (a match) does not finish the move by itself.

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

/** Pose landmark numbers: index fingertips, wrists, toes, heels. */
const HAND_POINTS = { L: 19, R: 20, LW: 15, RW: 16 } as const;
const FOOT_POINTS = { L: 31, R: 32, LH: 29, RH: 30 } as const;
const HOLD_MS = 350; // a limb must stay on the hold this long

export type Pt = { x: number; y: number };
/** Tracked points in overlay units (1000 wide, 1000 * aspect high), or null when nobody is seen. */
export type Body = { LH: Pt; RH: Pt; LF: Pt; RF: Pt; lw: Pt; rw: Pt; lh: Pt; rh: Pt; shoulders: [Pt, Pt]; hips: [Pt, Pt] };
export type TrackMove = { limb: "LH" | "RH" | "LF" | "RF"; at: Pt; r: number; hasHold: boolean };
/** A route hold for the climb record: its id in the /analyze answer, centre and catch radius in overlay units. */
export type TrackHold = { id: number; at: Pt; r: number };
/** One entry of the climb record: limb went onto hold (ms since tracking began, video time). */
export type ClimbEvent = { t: number; limb: "LH" | "RH" | "LF" | "RF"; hold: number };

/* ---- progress the voice coach reads: number of solve.moves done, -1 when not tracking ---- */
let progress = -1;
const subs = new Set<(p: number) => void>();
export const liveProgress = Object.assign(() => progress, {
  subscribe(cb: (p: number) => void) {
    subs.add(cb);
    return () => void subs.delete(cb);
  },
});
export function setLiveProgress(p: number) {
  if (p === progress) return;
  progress = p;
  subs.forEach((f) => f(p));
}

/* ---- camera ---- */
export async function openCamera(video: HTMLVideoElement): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return () => {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

/* ---- pose model ---- */
type Landmarker = { detectForVideo(v: HTMLVideoElement, t: number): { landmarks: { x: number; y: number; visibility?: number }[][] }; close(): void };
let modelPromise: Promise<Landmarker> | null = null;
function loadModel(): Promise<Landmarker> {
  modelPromise ??= (async () => {
    const vision = await import(/* @vite-ignore */ `${VISION}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    const make = (delegate: "GPU" | "CPU") =>
      vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    try {
      return await make("GPU");
    } catch {
      return await make("CPU");
    }
  })();
  modelPromise.catch(() => (modelPromise = null));
  return modelPromise;
}

/** Video point (0..1 of the frame) to overlay units, for a video shown with object-fit: cover in a
 *  box of the photo's shape (aspect = height / width). */
function toOverlay(nx: number, ny: number, video: HTMLVideoElement, aspect: number): Pt {
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  const va = vh / vw;
  if (va > aspect) {
    // video taller than the box: full width, top and bottom cut off
    return { x: nx * 1000, y: ny * 1000 * va - (1000 * va - 1000 * aspect) / 2 };
  }
  const w = 1000 * aspect / va; // shown width of the whole frame, in overlay units
  return { x: nx * w - (w - 1000) / 2, y: ny * 1000 * aspect };
}

/**
 * Start following the climber. moves: the whole solved sequence; done: how many are done already.
 * onBody gets the tracked points every frame; onDone(n) when the n-th move has just been done.
 * Returns { stop, setDone } (setDone: the user skipped or went back a move by hand).
 */
export async function track(
  video: HTMLVideoElement,
  o: {
    aspect: number;
    moves: TrackMove[];
    done: number;
    onBody: (b: Body | null) => void;
    onDone: (done: number) => void;
    onStatus?: (s: string) => void;
    /** route holds: every limb landing on any of them is recorded (the climb record) */
    holds?: TrackHold[];
  },
): Promise<{ stop: () => void; setDone: (n: number) => void; events: () => ClimbEvent[] }> {
  o.onStatus?.("Loading the body tracker…");
  const model = await loadModel();
  o.onStatus?.("");
  let stopped = false, raf = 0, last = -1;
  let done = o.done;
  // per tracked point: has it been off the current hold since the move began; since when it is on
  let wasOff: Record<string, boolean> = {}, onSince: Record<string, number> = {};
  const reset = () => ((wasOff = {}), (onSince = {}));
  setLiveProgress(done);
  // the climb record: which hold each limb is on, kept once it has stayed there HOLD_MS
  const events: ClimbEvent[] = [];
  const onHold: Record<string, number | null> = {};
  const cand: Record<string, { hold: number | null; since: number }> = {};
  const t0 = video.currentTime * 1000;

  const loop = () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (video.readyState < 2 || video.currentTime === last) return;
    last = video.currentTime;
    const now = video.currentTime * 1000; // video time: right for a live camera and for a filmed climb
    let res;
    try {
      res = model.detectForVideo(video, performance.now());
    } catch {
      return;
    }
    const lm = res.landmarks?.[0];
    if (!lm) return o.onBody(null);
    const p = (i: number) => toOverlay(lm[i].x, lm[i].y, video, o.aspect);
    const body: Body = {
      LH: p(HAND_POINTS.L), RH: p(HAND_POINTS.R), LF: p(FOOT_POINTS.L), RF: p(FOOT_POINTS.R),
      lw: p(HAND_POINTS.LW), rw: p(HAND_POINTS.RW), lh: p(FOOT_POINTS.LH), rh: p(FOOT_POINTS.RH),
      shoulders: [p(11), p(12)], hips: [p(23), p(24)],
    };
    o.onBody(body);

    for (const limb of ["LH", "RH", "LF", "RF"] as const) {
      const pt = body[limb];
      let best: number | null = null, bestD = Infinity;
      for (const h of o.holds ?? []) {
        const d = Math.hypot(pt.x - h.at.x, pt.y - h.at.y);
        if (d <= h.r && d < bestD) (best = h.id), (bestD = d);
      }
      const c = cand[limb];
      if (!c || c.hold !== best) cand[limb] = { hold: best, since: now };
      else if (best !== null && onHold[limb] !== best && now - c.since >= HOLD_MS) {
        onHold[limb] = best;
        events.push({ t: Math.round(c.since - t0), limb, hold: best });
      }
    }

    // Moves with no hold (a foot smearing on the wall) are done as soon as they come up.
    while (done < o.moves.length && !o.moves[done].hasHold) {
      done++;
      reset();
      setLiveProgress(done);
      o.onDone(done);
    }
    const m = o.moves[done];
    if (!m) return;
    const hand = m.limb === "LH" || m.limb === "RH";
    const pts: [string, Pt][] = hand ? [["L", body.LH], ["R", body.RH]] : [["L", body.LF], ["R", body.RF]];
    for (const [k, pt] of pts) {
      const on = Math.hypot(pt.x - m.at.x, pt.y - m.at.y) <= m.r;
      if (!on) {
        wasOff[k] = true;
        delete onSince[k];
        continue;
      }
      if (!wasOff[k]) continue;
      onSince[k] ??= now;
      if (now - onSince[k] >= HOLD_MS) {
        done++;
        reset();
        setLiveProgress(done);
        o.onDone(done);
        break;
      }
    }
  };
  loop();
  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      setLiveProgress(-1);
      o.onBody(null);
    },
    setDone: (n: number) => {
      done = Math.max(0, Math.min(n, o.moves.length));
      reset();
      setLiveProgress(done);
    },
    events: () => events.slice(),
  };
}
