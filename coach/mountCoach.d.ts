import type { CallDescription, CoachState, FootMoves } from "./coachTools.js";

export type CoachMode = "voice" | "speech" | "text";
export type CoachStatus = "idle" | "connecting" | "listening" | "speaking" | "error";

export type CoachOptions = {
  /** ElevenLabs agent id. Read it from a gitignored env var; never hard-code it. */
  agentId?: string;
  /** current /solve request body, its response, and GET /hold-types. Or use setState(). */
  getState?: (() => CoachState | null) | null;
  /** re-call /solve with the new height and update what getState returns */
  onHeightChange?: ((heightM: number) => Promise<void>) | null;
  /** 0-based index into solve.moves of the move being coached (moves.length when done) */
  onStepChange?: ((moveIndex: number) => void) | null;
  /** live or demo: number of solve.moves completed so far (e.g. createVideoProgress) */
  getProgress?: ((() => number) & { subscribe?: (cb: (p: number) => void) => () => void }) | null;
  /** default "merge": foot moves folded into the next hand call */
  footMoves?: FootMoves;
  /** default "voice"; falls back to "speech" by itself if voice fails */
  mode?: CoachMode;
  onStatus?: (s: { status: CoachStatus; mode: CoachMode; message: string | null }) => void;
  /** the current move sentence; call is null when finished or no route */
  onCaption?: (text: string, call: CallDescription | null) => void;
};

export type HeadlessCoachOptions = CoachOptions & {
  /** inject the ElevenLabs Conversation (default: dynamic import of @elevenlabs/client) */
  Conversation?: { startSession(options: Record<string, unknown>): Promise<{ endSession(): Promise<void>; sendUserMessage(text: string): void }> } | null;
  /** inject speech (default: the browser's speechSynthesis); null = none */
  speech?: { speak(text: string, cb?: { onStart?: () => void; onEnd?: () => void }): void; cancel(): void } | null;
  /** how often to read getProgress, ms (default 250; 0 = only via subscribe / tick()) */
  pollMs?: number;
  /** longest wait for the agent to stop speaking before nudging anyway, ms (default 6000) */
  nudgeWaitMs?: number;
};

export type HeadlessCoach = {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** speech/text: next move; voice: ask the agent for it */
  next(): void;
  /** read getProgress now */
  tick(): "advance" | "rewind" | null;
  setState(state: CoachState | null): void;
  getMode(): CoachMode;
  getStatus(): CoachStatus;
  getStep(): number;
  isActive(): boolean;
  clientTools: Record<string, (params?: Record<string, unknown>) => Promise<string>>;
};

export function createCoach(options?: HeadlessCoachOptions): HeadlessCoach;

export function createNudger(o: {
  getCallIndex: () => number | null;
  onAdvance: (callIndex: number) => void;
  onRewind: (callIndex: number) => void;
}): { tick(): "advance" | "rewind" | null; reset(callIndex?: number | null): void; last(): number | null };

export type MountedCoach = {
  start(): Promise<void>;
  stop(): Promise<void>;
  next(): void;
  setState(state: CoachState | null): void;
  destroy(): Promise<void>;
  coach: HeadlessCoach;
};

export function mountCoach(element: HTMLElement, options?: CoachOptions): MountedCoach;
