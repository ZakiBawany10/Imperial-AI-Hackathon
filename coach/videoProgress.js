// Demo mode: drive the coach from a filmed climb.
//
//   const getProgress = createVideoProgress(videoElement, [3.2, 6.8, 9.5]);
//   mountCoach(el, { ..., getProgress });
//
// moveTimestampsSec[k] is the time in the clip when solve.moves[k] is
// completed. getProgress() is how many of those times video.currentTime has
// passed, so pausing holds it, seeking jumps it, and going back lowers it
// (the coach then restarts from that move). No dependencies.

/** Number of timestamps at or before time t (seconds). Unsorted input is fine. */
export function progressAt(moveTimestampsSec, t) {
  if (!Number.isFinite(t)) return 0;
  let n = 0;
  for (const s of moveTimestampsSec || []) if (Number.isFinite(s) && s <= t) n++;
  return n;
}

/**
 * Returns getProgress(): the number of move timestamps passed at
 * video.currentTime. Also has:
 *   getProgress.subscribe(cb)  cb(progress) whenever it changes (on timeupdate,
 *                              seeked, play, pause, ended); returns unsubscribe
 *   getProgress.destroy()      removes the video listeners
 */
export function createVideoProgress(videoElement, moveTimestampsSec) {
  if (!videoElement) throw new Error("createVideoProgress needs a video element");
  const times = [...(moveTimestampsSec || [])].filter(Number.isFinite).sort((a, b) => a - b);
  const listeners = new Set();
  let last = null;

  const getProgress = () => progressAt(times, videoElement.currentTime);

  const check = () => {
    const now = getProgress();
    if (now === last) return;
    last = now;
    for (const cb of listeners) cb(now);
  };

  const EVENTS = ["timeupdate", "seeked", "seeking", "play", "pause", "ended", "loadedmetadata"];
  const canListen = typeof videoElement.addEventListener === "function";
  if (canListen) for (const e of EVENTS) videoElement.addEventListener(e, check);

  getProgress.subscribe = (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };
  getProgress.destroy = () => {
    if (canListen) for (const e of EVENTS) videoElement.removeEventListener(e, check);
    listeners.clear();
  };
  getProgress.times = times;
  return getProgress;
}
