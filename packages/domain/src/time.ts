import type { PauseInterval, TrackPoint } from './types.js';

function overlapMs(
  intervalStart: number,
  intervalEnd: number,
  pause: PauseInterval,
): number {
  return Math.max(
    0,
    Math.min(intervalEnd, pause.endedAtMs) -
      Math.max(intervalStart, pause.startedAtMs),
  );
}

export function normalizePauseIntervals(
  pauses: readonly PauseInterval[],
  activityStartMs: number,
  activityEndMs: number,
): readonly PauseInterval[] {
  const sorted = pauses
    .filter(
      (pause) =>
        Number.isFinite(pause.startedAtMs) &&
        Number.isFinite(pause.endedAtMs) &&
        pause.endedAtMs > pause.startedAtMs,
    )
    .map((pause) => ({
      startedAtMs: Math.max(activityStartMs, pause.startedAtMs),
      endedAtMs: Math.min(activityEndMs, pause.endedAtMs),
    }))
    .filter((pause) => pause.endedAtMs > pause.startedAtMs)
    .sort((left, right) => left.startedAtMs - right.startedAtMs);

  const merged: PauseInterval[] = [];
  for (const pause of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || pause.startedAtMs > previous.endedAtMs) {
      merged.push(pause);
    } else {
      merged[merged.length - 1] = {
        startedAtMs: previous.startedAtMs,
        endedAtMs: Math.max(previous.endedAtMs, pause.endedAtMs),
      };
    }
  }
  return merged;
}

export interface ActivityTimes {
  readonly elapsedTimeS: number;
  readonly movingTimeS: number;
  readonly pausedTimeS: number;
  readonly gapTimeS: number;
}

/** Gaps above maxSampleGapS are excluded from moving time as unobserved recording gaps. */
export function calculateActivityTimes(
  activityStartMs: number,
  activityEndMs: number,
  points: readonly TrackPoint[],
  pauses: readonly PauseInterval[] = [],
  maxSampleGapS = 10,
): ActivityTimes {
  if (activityEndMs < activityStartMs)
    throw new RangeError('Activity end precedes start');
  if (maxSampleGapS <= 0 || !Number.isFinite(maxSampleGapS)) {
    throw new RangeError('maxSampleGapS must be positive');
  }
  const elapsedTimeS = (activityEndMs - activityStartMs) / 1000;
  const normalizedPauses = normalizePauseIntervals(
    pauses,
    activityStartMs,
    activityEndMs,
  );
  const pausedTimeS =
    normalizedPauses.reduce(
      (total, pause) => total + pause.endedAtMs - pause.startedAtMs,
      0,
    ) / 1000;

  let movingTimeS = 0;
  let gapTimeS = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    const intervalMs = current.timestampMs - previous.timestampMs;
    if (intervalMs <= 0) continue;
    const pausedOverlapMs = normalizedPauses.reduce(
      (total, pause) =>
        total + overlapMs(previous.timestampMs, current.timestampMs, pause),
      0,
    );
    const activeIntervalS = Math.max(0, intervalMs - pausedOverlapMs) / 1000;
    if (intervalMs / 1000 > maxSampleGapS) gapTimeS += activeIntervalS;
    else movingTimeS += activeIntervalS;
  }

  return { elapsedTimeS, movingTimeS, pausedTimeS, gapTimeS };
}
