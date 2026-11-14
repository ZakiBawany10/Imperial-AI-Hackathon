// Voice coach: Zaki's ElevenLabs agent (coach/) with its client tools
// (coach/coachTools.js) reading the current /solve request and answer.
// The agent id comes from frontend/.env.local (gitignored):
//   VITE_ELEVENLABS_AGENT_ID=...   (ask Zaki; never commit it, the repo is public)

import { useCallback, useEffect, useRef, useState } from "react";
import { createCoachTools, type CoachState } from "@coach/coachTools.js";

export const COACH_AGENT_ID = (import.meta.env.VITE_ELEVENLABS_AGENT_ID as string | undefined) || "";

export type CoachStatus = "off" | "connecting" | "listening" | "speaking";
export type Coach = {
  available: boolean;
  status: CoachStatus;
  error: string | null;
  start: () => void;
  stop: () => void;
};

function why(e: unknown) {
  const name = (e as Error)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone blocked. Allow it, and open the app on https or localhost.";
  if (name === "NotFoundError") return "No microphone found.";
  return `Couldn't reach the coach: ${(e as Error)?.message ?? e}`;
}

export function useCoach(o: {
  getState: () => CoachState | null;
  onHeightChange: (heightM: number) => Promise<void>;
  /** 0-based index into solve.moves of the move being coached (moves.length when done) */
  onStep: (moveIndex: number) => void;
}): Coach {
  const opts = useRef(o);
  opts.current = o;
  const [status, setStatus] = useState<CoachStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const session = useRef<{ endSession: () => Promise<void> } | null>(null);
  const wanted = useRef(false);

  const stop = useCallback(() => {
    wanted.current = false;
    const s = session.current;
    session.current = null;
    setStatus("off");
    s?.endSession().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (!COACH_AGENT_ID) {
      setError("Voice coach not set up: add VITE_ELEVENLABS_AGENT_ID to frontend/.env.local.");
      return;
    }
    if (wanted.current) return;
    wanted.current = true;
    setError(null);
    setStatus("connecting");
    try {
      const tools = createCoachTools({
        getState: () => opts.current.getState(),
        onHeightChange: (h) => opts.current.onHeightChange(h),
        onStepChange: (i) => opts.current.onStep(i),
        footMoves: "merge",
      });
      const { Conversation } = await import("@elevenlabs/client");
      const s = await Conversation.startSession({
        agentId: COACH_AGENT_ID,
        connectionType: "webrtc",
        clientTools: tools.clientTools,
        onModeChange: ({ mode }) => setStatus(mode === "speaking" ? "speaking" : "listening"),
        onDisconnect: () => {
          session.current = null;
          wanted.current = false;
          setStatus("off");
        },
        onError: (message) => setError(message),
      });
      if (!wanted.current) {
        // stopped while connecting
        s.endSession().catch(() => {});
        return;
      }
      session.current = s;
      setStatus("listening");
    } catch (e) {
      wanted.current = false;
      setStatus("off");
      setError(why(e));
    }
  }, []);

  useEffect(() => () => stop(), [stop]);
  return { available: !!COACH_AGENT_ID, status, error, start, stop };
}
