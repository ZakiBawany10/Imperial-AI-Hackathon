export function progressAt(moveTimestampsSec: readonly number[], t: number): number;

export type VideoProgress = {
  /** number of move timestamps passed at video.currentTime */
  (): number;
  /** called with the new progress whenever it changes; returns unsubscribe */
  subscribe(cb: (progress: number) => void): () => void;
  /** remove the video listeners */
  destroy(): void;
  /** the timestamps, sorted */
  readonly times: number[];
};

export function createVideoProgress(
  videoElement: HTMLVideoElement | { currentTime: number; addEventListener?: unknown; removeEventListener?: unknown },
  moveTimestampsSec: readonly number[],
): VideoProgress;
