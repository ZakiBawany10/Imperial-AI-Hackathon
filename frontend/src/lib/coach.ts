// Voice coach: Zaki's createCoach (coach/mountCoach.js) over the current
// /solve request and answer. Voice is the ElevenLabs agent; if it can't run
// (no agent id, mic blocked, network) or drops mid-climb, the coach falls back
// to the browser reading the moves aloud, then to text.
// The agent id comes from frontend/.env.local (gitignored):
//   VITE_ELEVENLABS_AGENT_ID=...   (from Zaki; never commit it, the repo is public)

import { useCallback, useEffect, useRef, useState } from "react";
import { createCoach, type CoachMode, type HeadlessCoach } from "@coach/mountCoach.js";
import type { CoachState } from "@coach/coachTools.js";

export const COACH_AGENT_ID = (import.meta.env.VITE_ELEVENLABS_AGENT_ID as string | undefined) || "";

export type CoachStatus = "off" | "connecting" | "listening" | "speaking";
export type Coach = {
  /** voice agent configured; without it the coach starts straight in read-aloud mode */
  available: boolean;
  status: CoachStatus;
  mode: CoachMode;
  /** why it fell back, or an error */
  error: string | null;
  /** the sentence being coached */
  caption: string | null;
  start: () => void;
  stop: () => void;
  /** speech/text mode: call the next move (voice: ask the agent) */
  next: () => void;
};

export function useCoach(o: {
  getState: () => CoachState | null;
  onHeightChange: (heightM: number) => Promise<void>;
  /** 0-based index into solve.moves of the move being coached (moves.length when done) */
  onStep: (moveIndex: number) => void;
}): Coach {
  const opts = useRef(o);
  opts.current = o;
  const [status, setStatus] = useState<CoachStatus>("off");
  const [mode, setMode] = useState<CoachMode>("voice");
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const coach = useRef<HeadlessCoach | null>(null);

  if (!coach.current)
    coach.current = createCoach({
      agentId: COACH_AGENT_ID || undefined,
      getState: () => opts.current.getState(),
      onHeightChange: (h) => opts.current.onHeightChange(h),
      onStepChange: (i) => opts.current.onStep(i),
      onStatus: ({ status: st, mode: m, message }) => {
        setStatus(st === "idle" || st === "error" ? "off" : st);
        setMode(m);
        // speaking/listening updates carry no message: keep the last reason
        if (message) setError(message);
      },
      onCaption: (text) => setCaption(text),
    });

  const start = useCallback(() => {
    setError(null);
    void coach.current!.start();
  }, []);
  const stop = useCallback(() => {
    setCaption(null);
    setError(null);
    void coach.current!.stop();
  }, []);
  const next = useCallback(() => coach.current!.next(), []);

  useEffect(() => () => void coach.current?.stop(), []);
  return { available: !!COACH_AGENT_ID, status, mode, error, caption, start, stop, next };
}
