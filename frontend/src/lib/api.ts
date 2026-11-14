// Client for the backend API (contract: Documents/PLAN.md, contract/README.md).
// Base URL: VITE_API_URL, else port 8010 on the host serving the app (so a
// phone on the same Wi-Fi reaches the laptop running backend/run.sh).

import solveJson from "@contract/solve.json";
import solveRequestJson from "@contract/solve_request.json";
import { HOLD_DB, type ApiHold, type ApiHoldType } from "./contract";

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
  crux: number; // index into moves
  // hold is null when the live backend puts a foot on the wall or floor (a smear).
  // Not in the contract yet: reported to Krishna.
  moves: { i: number; limb: Limb; hold: number | null; load: number; span_m: number }[];
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
    throw new ApiError(`Can't reach the solver at ${API_URL}.`, 0, true);
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
