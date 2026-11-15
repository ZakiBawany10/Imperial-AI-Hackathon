import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoach, createNudger } from "./mountCoach.js";
import { createVideoProgress, progressAt } from "./videoProgress.js";
import { fixtureHoldTypes, fixtureMixedRequest, fixtureMixedSolve } from "./test_fixture.js";

// The mixed route has 9 moves; in "merge" mode they make 4 calls:
// [0,1] [2,3,4] [5,6,7] [8]. A call is done when its last move is done.
const STATE = { request: fixtureMixedRequest, solve: fixtureMixedSolve, holdTypes: fixtureHoldTypes };
const TIMES = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // move k done at k+1 seconds

function fakeVideo() {
  const listeners = {};
  return {
    currentTime: 0,
    addEventListener(e, fn) { (listeners[e] ||= new Set()).add(fn); },
    removeEventListener(e, fn) { listeners[e]?.delete(fn); },
    fire(e) { for (const fn of listeners[e] || []) fn(); },
    count() { return Object.values(listeners).reduce((n, s) => n + s.size, 0); },
  };
}

function fakeSpeech() {
  const said = [];
  return { said, speak(text) { said.push(text); }, cancel() {} };
}

function fakeConversation({ fail = false } = {}) {
  const f = { sent: [], ended: 0, callbacks: null };
  f.Conversation = {
    async startSession(opts) {
      if (fail) throw new Error("mic blocked");
      f.callbacks = opts;
      f.tools = opts.clientTools;
      return {
        sendUserMessage: (t) => f.sent.push(t),
        endSession: async () => { f.ended++; },
      };
    },
  };
  return f;
}

// ---------------------------------------------------------------------------

test("progressAt counts timestamps passed", () => {
  assert.equal(progressAt(TIMES, 0), 0);
  assert.equal(progressAt(TIMES, 1), 1);
  assert.equal(progressAt(TIMES, 4.5), 4);
  assert.equal(progressAt([3, 1, 2], 2.5), 2); // unsorted is fine
  assert.equal(progressAt(TIMES, NaN), 0);
});

test("videoProgress follows play, pause, seek and replay", () => {
  const v = fakeVideo();
  const gp = createVideoProgress(v, TIMES);
  const seen = [];
  gp.subscribe((p) => seen.push(p));

  v.currentTime = 2.5; v.fire("timeupdate");
  assert.equal(gp(), 2);
  v.fire("pause"); v.fire("timeupdate"); // paused: same time, no new event
  assert.equal(gp(), 2);
  v.currentTime = 7.2; v.fire("seeked"); // seek forward
  assert.equal(gp(), 7);
  v.currentTime = 1.5; v.fire("seeked"); // seek back
  assert.equal(gp(), 1);
  v.currentTime = 0; v.fire("play"); // replay from the start
  assert.equal(gp(), 0);
  assert.deepEqual(seen, [2, 7, 1, 0]);

  gp.destroy();
  assert.equal(v.count(), 0);
});

test("nudger: advances once per step, never repeats, reports rewinds", () => {
  let c = 0;
  const events = [];
  const n = createNudger({ getCallIndex: () => c, onAdvance: (i) => events.push(["advance", i]), onRewind: (i) => events.push(["rewind", i]) });
  n.tick(); // baseline
  n.tick(); n.tick(); // no change, nothing
  c = 1; n.tick(); n.tick();
  c = 2; n.tick();
  c = 0; n.tick();
  c = 1; n.tick();
  assert.deepEqual(events, [["advance", 1], ["advance", 2], ["rewind", 0], ["advance", 1]]);
});

test("speech mode: reads each call once as the video plays, restarts on rewind", async () => {
  const v = fakeVideo();
  const getProgress = createVideoProgress(v, TIMES);
  const sp = fakeSpeech();
  const steps = [];
  const coach = createCoach({ getState: () => STATE, getProgress, mode: "speech", speech: sp, pollMs: 0, onStepChange: (i) => steps.push(i) });
  await coach.start();
  assert.equal(sp.said.length, 1); // call 1 straight away

  // Play through every timestamp, firing timeupdate several times per second.
  for (let t = 0; t <= 10; t += 0.25) { v.currentTime = t; v.fire("timeupdate"); coach.tick(); }
  assert.equal(sp.said.length, 5, sp.said.join(" | ")); // 4 calls + finished, no skips, no repeats
  assert.match(sp.said[0], /^High right foot, then/);
  assert.match(sp.said[1], /^Crux move\. Feet up, then/);
  assert.match(sp.said[3], /^Match hands/);
  assert.equal(sp.said[4], "That's the top. Route finished.");
  assert.deepEqual(steps, [0, 2, 5, 8, 9]);

  // Rewind to just after move 3 (index 2) was done: call 2 starts again.
  v.currentTime = 3.1; v.fire("seeked");
  assert.equal(sp.said.length, 6);
  assert.equal(sp.said[5], sp.said[1]);
  coach.tick(); coach.tick(); // no repeat
  assert.equal(sp.said.length, 6);
  await coach.stop();
});

test("a foot done inside a merged call doesn't trigger the next call", async () => {
  let done = 0;
  const sp = fakeSpeech();
  const coach = createCoach({ getState: () => STATE, getProgress: () => done, mode: "speech", speech: sp, pollMs: 0 });
  await coach.start();
  done = 1; coach.tick(); // foot of call 1 done, hand not yet
  assert.equal(sp.said.length, 1);
  done = 2; coach.tick();
  assert.equal(sp.said.length, 2);
  await coach.stop();
});

test("speech mode without progress: Next move button steps through", async () => {
  const sp = fakeSpeech();
  const coach = createCoach({ getState: () => STATE, mode: "speech", speech: sp, pollMs: 0 });
  await coach.start();
  coach.next(); coach.next(); coach.next(); coach.next(); coach.next(); // past the end stays finished
  assert.equal(sp.said.length, 6);
  assert.equal(sp.said[4], "That's the top. Route finished.");
});

test("text mode: captions only, no audio", async () => {
  const sp = fakeSpeech();
  const captions = [];
  const coach = createCoach({ getState: () => STATE, mode: "text", speech: sp, pollMs: 0, onCaption: (t) => captions.push(t) });
  await coach.start();
  coach.next();
  assert.equal(sp.said.length, 0);
  assert.equal(captions.length, 2);
});

test("voice mode: progress nudges the agent with a user message, once per call", async () => {
  let done = 0;
  const f = fakeConversation();
  const statuses = [];
  const coach = createCoach({ agentId: "test-agent", getState: () => STATE, getProgress: () => done, Conversation: f.Conversation, speech: fakeSpeech(), pollMs: 0, onStatus: (s) => statuses.push(s.status) });
  await coach.start();
  assert.equal(coach.getMode(), "voice");
  assert.ok(statuses.includes("connecting") && statuses.at(-1) === "listening");

  done = 1; coach.tick(); // inside call 1: nothing
  assert.equal(f.sent.length, 0);
  done = 2; coach.tick(); coach.tick();
  assert.deepEqual(f.sent, ["Done. What's my next move?"]);

  // While the agent is speaking the nudge waits for it to finish.
  f.callbacks.onModeChange({ mode: "speaking" });
  done = 5; coach.tick();
  assert.equal(f.sent.length, 1);
  f.callbacks.onModeChange({ mode: "listening" });
  assert.equal(f.sent.length, 2);

  // The agent's get_next_move reads progress, so it gets call 3 (index 2), not a skip.
  const r = JSON.parse(await f.tools.get_next_move({ climber_finished_last_move: true }));
  assert.equal(r.move_number, 3);

  done = 2; coach.tick(); // rewind
  assert.equal(f.sent.at(-1), "I've gone back a bit. What's my move from here?");
  await coach.stop();
  assert.equal(f.ended, 1);
});

test("voice falls back to speech when it can't connect", async () => {
  const f = fakeConversation({ fail: true });
  const sp = fakeSpeech();
  const msgs = [];
  const coach = createCoach({ agentId: "test-agent", getState: () => STATE, Conversation: f.Conversation, speech: sp, pollMs: 0, onStatus: (s) => msgs.push(s.message) });
  await coach.start();
  assert.equal(coach.getMode(), "speech");
  assert.match(msgs.at(-1), /Voice unavailable \(mic blocked\), reading moves aloud instead/);
  assert.equal(sp.said.length, 1);
  assert.match(sp.said[0], /^High right foot/);
});

test("voice falls back mid-session from the move it was on, and not after a normal stop", async () => {
  const f = fakeConversation();
  const sp = fakeSpeech();
  const coach = createCoach({ agentId: "test-agent", getState: () => STATE, Conversation: f.Conversation, speech: sp, pollMs: 0 });
  await coach.start();
  // The agent has coached calls 1 and 2.
  await f.tools.get_next_move({ climber_finished_last_move: false });
  await f.tools.get_next_move({ climber_finished_last_move: true });
  f.callbacks.onError("connection lost");
  assert.equal(coach.getMode(), "speech");
  assert.equal(sp.said.length, 1);
  assert.match(sp.said[0], /^Crux move\. Feet up/); // call 2, where it was
  await coach.stop();

  // A user stop that disconnects must not fall back.
  const g = fakeConversation();
  const sp2 = fakeSpeech();
  const c2 = createCoach({ agentId: "test-agent", getState: () => STATE, Conversation: g.Conversation, speech: sp2, pollMs: 0 });
  await c2.start();
  await c2.stop();
  g.callbacks.onDisconnect();
  assert.equal(sp2.said.length, 0);
  assert.equal(c2.getStatus(), "idle");
});

test("no agent id: straight to speech; no speech either: text", async () => {
  const sp = fakeSpeech();
  const a = createCoach({ getState: () => STATE, speech: sp, pollMs: 0, Conversation: fakeConversation().Conversation });
  await a.start();
  assert.equal(a.getMode(), "speech");
  const b = createCoach({ getState: () => STATE, speech: null, pollMs: 0, Conversation: fakeConversation({ fail: true }).Conversation, agentId: "x" });
  await b.start();
  assert.equal(b.getMode(), "text");
});

test("setState works without getState, and the voice caption follows the agent", async () => {
  const f = fakeConversation();
  const captions = [];
  const coach = createCoach({ agentId: "test-agent", Conversation: f.Conversation, speech: null, pollMs: 0, onCaption: (t) => captions.push(t) });
  coach.setState(STATE);
  await coach.start();
  await f.tools.get_next_move({ climber_finished_last_move: false });
  assert.match(captions.at(-1), /^High right foot/);
});
