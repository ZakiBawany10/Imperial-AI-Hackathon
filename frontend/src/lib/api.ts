// Client for the backend API (contract: Documents/PLAN.md, contract/README.md).
// Base URL: VITE_API_URL, else port 8010 on the host serving the app (so a
// phone on the same Wi-Fi reaches the laptop running backend/run.sh).

import solveJson from "@contract/solve.json";
import solveRequestJson from "@contract/solve_request.json";
import { HOLD_DB, type Analyze, type ApiHold, type ApiHoldType } from "./contract";

export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  `http://${window.location.hostname || "localhost"}:8010`;

export type Limb = "LH" | "RH" | "LF" | "RF";
export type JointName =
  | "head"
  | "hip"
  | "lh"
  | "rh"
  | "l_elbow"
  | "r_elbow"
  | "lf"
  | "rf"
  | "l_knee"
  | "r_knee";

export type SolveRequest = {
  image: { w: number; h: number };
  holds: ApiHold[];
  start: number[];
  finish: number[];
  climber_height_m: number;
  wall_height_m: number;
  wall_angle_deg: number;
};
export type SolveResponse = {
  grade: { font: string; v: string; low: string; high: string };
  /** live backend, not yet in the contract: physics summary incl. the chance of
   *  topping the safest sequence */
  physics?: { finish_chance?: number; sequence?: string; max_effort?: number };
  crux: number; // index into moves
  // hold is null when the live backend puts a foot on the wall or floor (a smear).
  // Not in the contract yet: reported to Krishna.
  // fall_chance: live backend, not yet in the contract.
  moves: { i: number; limb: Limb; hold: number | null; load: number; span_m: number; fall_chance?: number }[];
  keyframes: { move: number; joints: Record<JointName, [number, number]> }[];
};

/** `offline` = the server could not be reached at all (vs. it answered with an error). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly offline = false,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(`Can't reach the BetaCrux server at ${API_URL}. Is backend/run.sh running?`, 0, true);
  }
  if (!res.ok) {
    let detail = `The server answered ${res.status}.`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

/** POST /analyze (form field `file`). */
export function analyze(photo: Blob, signal?: AbortSignal) {
  const body = new FormData();
  body.append("file", photo, "wall.jpg");
  return call<Analyze>("/analyze", { method: "POST", body, signal });
}

/** Upright (EXIF applied, as <img> shows it) and at most `max` px on the long
 *  side, so phone photos upload fast. The result is both sent and displayed,
 *  so /analyze pixels match what is drawn. Falls back to the original file. */
export async function shrinkPhoto(file: File, max = 2048): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.type === "image/jpeg") return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise<Blob>((ok, no) =>
      c.toBlob((b) => (b ? ok(b) : no(new Error("toBlob"))), "image/jpeg", 0.9),
    );
  } catch {
    return file;
  }
}

export function solve(req: SolveRequest, signal?: AbortSignal) {
  return call<SolveResponse>("/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
}

/* ---- hold database: GET /hold-types, the contract example until it answers ---- */
let holdTypes: ApiHoldType[] = HOLD_DB;
export const getHoldTypes = () => holdTypes;
export async function loadHoldTypes() {
  try {
    const list = await call<ApiHoldType[]>("/hold-types");
    if (Array.isArray(list) && list.length) holdTypes = list;
  } catch {
    /* keep the example list */
  }
  return holdTypes;
}
export const qualityOf = (type: string) =>
  holdTypes.find((t) => t.id === type)?.quality ?? holdTypes.find((t) => t.id === "unknown")?.quality ?? 0.5;

/** The fixed example pair (yellow route on contract/wall.jpg), for when the server is down. */
export const EXAMPLE_SOLVE = {
  req: solveRequestJson as SolveRequest,
  res: solveJson as SolveResponse,
};
