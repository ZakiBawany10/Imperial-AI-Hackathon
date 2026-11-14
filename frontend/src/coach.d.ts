// Types for Zaki's coach/coachTools.js (plain JS, read-only from here).
declare module "@coach/coachTools.js" {
  export type CoachState = { request: unknown; solve: unknown; holdTypes?: unknown };
  export type MoveDescription = {
    move_number: number;
    say: string;
    phrasings?: string[];
    is_crux?: boolean;
    how_far?: string;
  };
  export function describeMove(
    request: unknown,
    solve: unknown,
    i: number,
    holdTypes?: unknown,
  ): MoveDescription | null;
  export function createCoachTools(options: {
    getState: () => CoachState | null;
    onHeightChange?: ((heightM: number) => Promise<void>) | null;
    onStepChange?: ((moveIndex: number) => void) | null;
    getProgress?: (() => number) | null;
    footMoves?: "merge" | "skip" | "call";
  }): {
    clientTools: Record<string, (params?: Record<string, unknown>) => Promise<string>>;
    getStep: () => number;
    reset: () => void;
  };
}
