// Types for coachTools.js. Shapes follow the API contract (Documents/PLAN.md);
// request/solve are left loose so the frontend can pass its own typed objects.

export type FootMoves = "merge" | "skip" | "call";

export type CoachState = { request: unknown; solve: unknown; holdTypes?: unknown };

export type MoveDescription = {
  move_number: number;
  total_moves: number;
  limb: string;
  hold_type: string | null;
  hold_description: string | null;
  hold_reference: string | null;
  on_route_hold: boolean;
  reach: string | null;
  body_position: string | null;
  body_side: string | null;
  direction: string | null;
  /** "about 1.4 metres": only for when the climber asks how far */
  how_far: string | null;
  distance_m: number | null;
  is_match: boolean;
  is_crux: boolean;
  is_finish_hold: boolean;
  is_last_move: boolean;
  /** main sentence */
  say: string;
  /** 2 or 3 ways of saying it, say first */
  phrasings: string[];
  /** foot moves only: short form used when merged into a hand call */
  short?: string;
  crux_tips?: string[];
};

export type CallDescription = MoveDescription & {
  /** indices into solve.moves covered by this call */
  move_indices: number[];
  feet_first: string[];
};

export type Call = { moves: number[]; main: number };

export function holdTypeWords(type: string | null | undefined, holdTypes?: unknown): string;
export function distanceWords(metres: number): string;
export function directionWords(dxPx: number, dyUpPx: number): string;
export function reachWords(fractionOfHeight: number): string | null;
export function colourName(hex: string | null | undefined): string | null;
export function describeMove(request: unknown, solve: unknown, i: number, holdTypes?: unknown): MoveDescription | null;
export function planCalls(solve: unknown, footMoves?: FootMoves): Call[];
export function callForProgress(calls: Call[], done: number): number;
export function describeCall(request: unknown, solve: unknown, calls: Call[], c: number, holdTypes?: unknown): CallDescription | null;
export function describeRoute(
  request: unknown,
  solve: unknown,
  holdTypes?: unknown,
  footMoves?: FootMoves,
): {
  grade: string;
  grade_range: string | null;
  total_moves: number;
  crux_move_number: number | null;
  climber_height_m: number | null;
  moves: string[];
};

export type CoachToolsOptions = {
  getState: () => CoachState | null;
  onHeightChange?: ((heightM: number) => Promise<void>) | null;
  /** 0-based index into solve.moves of the move being coached (moves.length when done) */
  onStepChange?: ((moveIndex: number) => void) | null;
  /** live/demo: number of solve.moves completed so far */
  getProgress?: (() => number) | null;
  footMoves?: FootMoves;
};

export function createCoachTools(options: CoachToolsOptions): {
  clientTools: Record<string, (params?: Record<string, unknown>) => Promise<string>>;
  getStep: () => number;
  reset: () => void;
};
