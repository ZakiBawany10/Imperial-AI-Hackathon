// Drop-in BetaCrux voice coach for the app.
//
//   import { mountCoach } from "@coach/mountCoach.js";
//   const coach = mountCoach(document.getElementById("coach"), {
//     agentId: import.meta.env.VITE_ELEVENLABS_AGENT_ID,   // never hard-code it
//     getState: () => ({ request: solveRequest, solve: solveResponse, holdTypes }),
//     onHeightChange: async (h) => { /* POST /solve again with climber_height_m: h */ },
//   });
//
// Renders a Start/Stop button, a status line and a caption of the current move.
// Modes:
//   "voice"  (default) the ElevenLabs agent, with the client tools from coachTools.js
//   "speech" no ElevenLabs: the browser reads the same move sentences aloud, with a "Next move" button
//   "text"   captions only
// If voice fails to connect, or errors or drops mid-session, the coach falls back to
// "speech" from the move it was on and says so in the status line.
//
// With getProgress (live tracking, or createVideoProgress for a filmed climb), the
// coach calls the next move by itself when progress goes up ("the nudge"), and
// restarts from the right move when it goes back.
//
// Layers, so each can be used or tested alone:
//   createNudger  pure: turns progress readings into "advanced to call c" / "went back to call c"
//   createCoach   headless controller, no DOM: modes, fallback, nudge, captions via callbacks
//   mountCoach    the small DOM widget on top of createCoach

import { callForProgress, createCoachTools, describeCall, planCalls } from "./coachTools.js";

const FINISHED_SAY = "That's the top. Route finished.";
const NUDGE_DONE = "Done. What's my next move?";
const NUDGE_BACK = "I've gone back a bit. What's my move from here?";

/**
 * Turns progress readings into coach calls. getCallIndex() returns the call to
 * coach now (or null if unknown). tick() compares it with the last reading:
 * higher calls onAdvance(c), lower calls onRewind(c), same does nothing. The
 * first reading only sets the baseline. Never fires twice for the same reading.
 */
export function createNudger({ getCallIndex, onAdvance, onRewind }) {
  let last = null;
  return {
    tick() {
      const c = getCallIndex();
      if (!Number.isInteger(c)) return null;
      if (last === null) {
        last = c;
        return null;
      }
      if (c === last) return null;
      const kind = c > last ? "advance" : "rewind";
      last = c;
      (kind === "advance" ? onAdvance : onRewind)(c);
      return kind;
    },
    reset(c = null) {
      last = Number.isInteger(c) ? c : null;
    },
    last: () => last,
  };
}

function browserSpeech() {
  const synth = typeof globalThis !== "undefined" ? globalThis.speechSynthesis : null;
  const Utterance = typeof globalThis !== "undefined" ? globalThis.SpeechSynthesisUtterance : null;
  if (!synth || !Utterance) return null;
  return {
    speak(text, { onStart, onEnd } = {}) {
      synth.cancel();
      const u = new Utterance(text);
      u.rate = 0.9; // a touch slower than default: they're on the wall
      u.lang = "en-GB";
      if (onStart) u.onstart = onStart;
      if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
      synth.speak(u);
    },
    cancel() {
      synth.cancel();
    },
  };
}

const MODES = ["voice", "speech", "text"];

/**
 * Headless coach. See mountCoach for the options; extra ones here:
 *   onStatus({ status, mode, message })   status: idle | connecting | listening | speaking | error
 *   onCaption(text, call)                 the current move sentence (call is null when finished)
 *   Conversation                          injectable ElevenLabs Conversation (default: import("@elevenlabs/client"))
 *   speech                                injectable { speak(text, {onStart, onEnd}), cancel() } (default: browser speechSynthesis)
 *   pollMs                                how often to read getProgress (default 250; 0 = only on subscribe / tick())
 */
export function createCoach(options = {}) {
  const {
    agentId = "",
    getState: getStateOpt = null,
    onHeightChange = null,
    onStepChange = null,
    getProgress = null,
    footMoves = "merge",
    mode: requestedMode = "voice",
    onStatus = () => {},
    onCaption = () => {},
    Conversation: ConversationOpt = null,
    speech: speechOpt,
    pollMs = 250,
    nudgeWaitMs = 6000,
  } = options;
  if (!MODES.includes(requestedMode)) throw new Error(`mode must be one of ${MODES.join(", ")}`);

  let stored = null;
  const getState = () => (getStateOpt ? getStateOpt() : stored);
  const speech = speechOpt === undefined ? browserSpeech() : speechOpt;

  let mode = requestedMode;
  let status = "idle";
  let active = false;
  let stopping = false;
  let session = null;
  let agentSpeaking = false;
  let pendingNudge = null;
  let pendingTimer = null;
  let pollTimer = null;
  let unsubscribe = null;
  let step = 0; // speech/text: index of the call being coached

  const tools = createCoachTools({
    getState,
    onHeightChange,
    onStepChange: (i) => onStepChange && onStepChange(i),
    getProgress,
    footMoves,
  });

  function setStatus(next, message = null) {
    status = next;
    onStatus({ status, mode, message });
  }

  function calls() {
    const s = getState();
    return s && s.solve && Array.isArray(s.solve.moves) ? planCalls(s.solve, footMoves) : null;
  }

  function progressCall() {
    if (typeof getProgress !== "function") return null;
    const cl = calls();
    const done = Number(getProgress());
    if (!cl || !Number.isInteger(done) || done < 0) return null;
    return callForProgress(cl, done);
  }

  // --- speech / text ---------------------------------------------------------

  function sayCall(c) {
    const s = getState();
    const cl = calls();
    if (!s || !cl) {
      onCaption("No route yet. Solve a route first.", null);
      return;
    }
    step = Math.max(0, Math.min(c, cl.length));
    let text;
    let call = null;
    if (step >= cl.length) {
      text = FINISHED_SAY;
      if (onStepChange) onStepChange(s.solve.moves.length);
    } else {
      call = describeCall(s.request, s.solve, cl, step, s.holdTypes);
      text = call.is_crux ? `Crux move. ${call.say}` : call.say;
      if (onStepChange) onStepChange(cl[step].moves[0]);
    }
    onCaption(text, call);
    if (mode === "speech" && speech) {
      speech.speak(text, {
        onStart: () => active && setStatus("speaking"),
        onEnd: () => active && setStatus("listening"),
      });
    }
  }

  // --- voice ----------------------------------------------------------------

  // Show the agent's current move as the caption: wrap the tools it calls.
  const voiceTools = {};
  for (const [name, fn] of Object.entries(tools.clientTools)) {
    voiceTools[name] = async (params) => {
      const out = await fn(params);
      try {
        const r = JSON.parse(out);
        if (name === "get_next_move" && r.say) onCaption(r.status === "finished" ? FINISHED_SAY : r.say, r.status ? null : r);
      } catch { /* not JSON: leave the caption */ }
      return out;
    };
  }

  function flushNudge() {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    const text = pendingNudge;
    pendingNudge = null;
    if (!text || !session || mode !== "voice") return;
    try {
      // A user message makes the agent respond, exactly as if the climber had
      // said it; a contextual update would be silent background. The agent then
      // calls get_next_move, which reads getProgress, so it can't skip or repeat.
      session.sendUserMessage(text);
    } catch (e) {
      fallback(`couldn't nudge the agent: ${e && e.message ? e.message : e}`);
    }
  }

  function nudgeVoice(text) {
    pendingNudge = text; // only the latest nudge is kept
    if (!agentSpeaking) return flushNudge();
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flushNudge, nudgeWaitMs); // don't wait forever for a pause
  }

  async function startVoice() {
    if (!agentId) return fallback("no agent id");
    setStatus("connecting");
    try {
      const Conversation = ConversationOpt || (await import("@elevenlabs/client")).Conversation;
      const s = await Conversation.startSession({
        agentId,
        connectionType: "webrtc",
        clientTools: voiceTools,
        onModeChange: ({ mode: m }) => {
          agentSpeaking = m === "speaking";
          if (!active || mode !== "voice") return;
          setStatus(agentSpeaking ? "speaking" : "listening");
          if (!agentSpeaking && pendingNudge) flushNudge();
        },
        onError: (message) => {
          if (active && mode === "voice") fallback(String(message || "voice error"));
        },
        onDisconnect: () => {
          session = null;
          if (active && !stopping && mode === "voice") fallback("voice disconnected");
        },
      });
      if (!active || mode !== "voice") {
        // stopped, or fell back, while connecting
        s.endSession().catch(() => {});
        return;
      }
      session = s;
      setStatus("listening");
    } catch (e) {
      if (active && mode === "voice") fallback(e && e.message ? e.message : String(e));
    }
  }

  /** Switch from voice to speech (or text if the browser can't speak), from the current move. */
  function fallback(reason) {
    if (mode !== "voice") return;
    const s = session;
    session = null;
    pendingNudge = null;
    clearTimeout(pendingTimer);
    if (s) s.endSession().catch(() => {});
    mode = speech ? "speech" : "text";
    const how = speech ? "reading moves aloud" : "showing moves as text";
    setStatus("listening", `Voice unavailable (${reason}), ${how} instead.`);
    if (!active) return;
    const fromProgress = progressCall();
    sayCall(fromProgress != null ? fromProgress : tools.getStep());
  }

  // --- progress -------------------------------------------------------------

  const nudger = createNudger({
    getCallIndex: progressCall,
    onAdvance: (c) => {
      if (!active) return;
      if (mode === "voice") nudgeVoice(NUDGE_DONE);
      else sayCall(c);
    },
    onRewind: (c) => {
      if (!active) return;
      if (mode === "voice") nudgeVoice(NUDGE_BACK);
      else sayCall(c);
    },
  });

  function tick() {
    return nudger.tick();
  }

  // --- public ---------------------------------------------------------------

  async function start() {
    if (active) return;
    active = true;
    stopping = false;
    mode = requestedMode;
    if (mode === "speech" && !speech) mode = "text";
    nudger.reset(progressCall());
    if (typeof getProgress === "function") {
      if (typeof getProgress.subscribe === "function") unsubscribe = getProgress.subscribe(() => tick());
      if (pollMs > 0) pollTimer = setInterval(tick, pollMs);
    }
    if (mode === "voice") {
      tools.reset();
      await startVoice();
    } else {
      setStatus("listening", mode === "text" && requestedMode === "speech" ? "This browser can't speak; showing moves as text." : null);
      const p = progressCall();
      sayCall(p != null ? p : 0);
    }
  }

  async function stop() {
    if (!active) return;
    stopping = true;
    active = false;
    clearInterval(pollTimer);
    pollTimer = null;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    clearTimeout(pendingTimer);
    pendingNudge = null;
    if (speech) speech.cancel();
    const s = session;
    session = null;
    if (s) await s.endSession().catch(() => {});
    mode = requestedMode;
    setStatus("idle");
  }

  /** Speech/text: call the next move (the "Next move" button). Voice: ask the agent. */
  function next() {
    if (!active) return;
    if (mode === "voice") return nudgeVoice(NUDGE_DONE);
    sayCall(step + 1);
  }

  /** Use when not passing getState: the current /solve request, its response, and hold types. */
  function setState(state) {
    const before = stored && stored.solve ? JSON.stringify(stored.solve.moves) : null;
    stored = state;
    const after = state && state.solve ? JSON.stringify(state.solve.moves) : null;
    if (active && mode !== "voice" && before !== after) {
      const p = progressCall();
      sayCall(p != null ? p : 0);
    }
  }

  return {
    start,
    stop,
    next,
    tick,
    setState,
    getMode: () => mode,
    getStatus: () => status,
    getStep: () => (mode === "voice" ? tools.getStep() : step),
    isActive: () => active,
    clientTools: voiceTools,
  };
}

/**
 * Mount the coach widget into `element`.
 * options: { agentId, getState, onHeightChange, onStepChange, getProgress, footMoves = "merge", mode = "voice" }
 * Returns { start, stop, destroy, setState, next, coach }.
 */
export function mountCoach(element, options = {}) {
  if (!element) throw new Error("mountCoach needs an element");
  const doc = element.ownerDocument || document;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  const root = el("div", "betacrux-coach");
  const row = el("div", "betacrux-coach__row");
  const toggle = el("button", "betacrux-coach__toggle", "Start coach");
  toggle.type = "button";
  const nextBtn = el("button", "betacrux-coach__next", "Next move");
  nextBtn.type = "button";
  nextBtn.hidden = true;
  const statusLine = el("div", "betacrux-coach__status", "Coach off");
  statusLine.setAttribute("role", "status");
  const caption = el("p", "betacrux-coach__caption");
  caption.setAttribute("aria-live", "polite");
  row.append(toggle, nextBtn);
  root.append(row, statusLine, caption);
  element.appendChild(root);

  const WORDS = { idle: "Coach off", connecting: "Connecting…", listening: "Listening", speaking: "Speaking", error: "Error" };
  const MODE_WORDS = { voice: "Voice coach", speech: "Spoken moves", text: "Captions" };

  const coach = createCoach({
    ...options,
    onStatus: ({ status, mode, message }) => {
      const base = status === "idle" ? WORDS.idle : `${MODE_WORDS[mode]}: ${WORDS[status] || status}`;
      statusLine.textContent = message ? `${base}. ${message}` : base;
      root.dataset.status = status;
      root.dataset.mode = mode;
      toggle.textContent = status === "idle" ? "Start coach" : "Stop coach";
      nextBtn.hidden = status === "idle" || mode === "voice";
      if (options.onStatus) options.onStatus({ status, mode, message });
    },
    onCaption: (text, call) => {
      caption.textContent = text;
      if (options.onCaption) options.onCaption(text, call);
    },
  });

  toggle.addEventListener("click", () => (coach.isActive() ? coach.stop() : coach.start()));
  nextBtn.addEventListener("click", () => coach.next());

  return {
    start: () => coach.start(),
    stop: () => coach.stop(),
    next: () => coach.next(),
    setState: (s) => coach.setState(s),
    destroy: async () => {
      await coach.stop();
      root.remove();
    },
    coach,
  };
}
