import { haversineDistanceM, isValidTrackPoint } from './geo.js';
import type { ActivitySport, TrackPoint } from './types.js';

export type AccuracyClass = 'preferred' | 'usable' | 'poor' | 'unknown';
export type RejectionReason = 'invalid' | 'poor_accuracy' | 'impossible_jump';

export const SPORT_MAX_SPEED_MPS: Readonly<Record<ActivitySport, number>> = {
  run: 12,
  walk: 12,
  hike: 12,
  ride: 30,
};

export function classifyAccuracy(accuracyM?: number | null): AccuracyClass {
  if (accuracyM == null) return 'unknown';
  if (!Number.isFinite(accuracyM) || accuracyM < 0) return 'poor';
  if (accuracyM <= 20) return 'preferred';
  if (accuracyM <= 50) return 'usable';
  return 'poor';
}

export function isImpossibleJump(
  from: TrackPoint,
  to: TrackPoint,
  sport: ActivitySport,
): boolean {
  const elapsedSeconds = (to.timestampMs - from.timestampMs) / 1000;
  if (elapsedSeconds <= 0) return true;
  return (
    haversineDistanceM(from, to) / elapsedSeconds > SPORT_MAX_SPEED_MPS[sport]
  );
}

export interface FilteredTrack {
  readonly accepted: readonly TrackPoint[];
  readonly rejected: readonly {
    readonly point: TrackPoint;
    readonly reason: RejectionReason;
  }[];
}

/**
 * Applies validation, the 50 m accuracy cutoff, and jump rejection without mutating input.
 * If no fix is at or below 50 m, all valid poor fixes become fallback candidates in source
 * order; greedy sport jump rejection then preserves a usable stream anchored at the first fix.
 */
export function filterTrackPoints(
  source: readonly TrackPoint[],
  sport: ActivitySport,
): FilteredTrack {
  const accepted: TrackPoint[] = [];
  const rejected: {
    point: TrackPoint;
    reason: RejectionReason;
    sourceIndex: number;
  }[] = [];
  const validCandidates: { point: TrackPoint; sourceIndex: number }[] = [];
  let previousValid: TrackPoint | undefined;

  source.forEach((point, sourceIndex) => {
    if (!isValidTrackPoint(point, previousValid)) {
      rejected.push({ point, reason: 'invalid', sourceIndex });
      return;
    }
    validCandidates.push({ point, sourceIndex });
    previousValid = point;
  });

  const hasNonPoorFix = validCandidates.some(
    ({ point }) => classifyAccuracy(point.accuracyM) !== 'poor',
  );
  for (const { point, sourceIndex } of validCandidates) {
    if (hasNonPoorFix && classifyAccuracy(point.accuracyM) === 'poor') {
      rejected.push({ point, reason: 'poor_accuracy', sourceIndex });
      continue;
    }
    const previous = accepted.at(-1);
    if (previous !== undefined && isImpossibleJump(previous, point, sport)) {
      rejected.push({ point, reason: 'impossible_jump', sourceIndex });
      continue;
    }
    accepted.push({ ...point });
  }

  return {
    accepted,
    rejected: rejected
      .sort((left, right) => left.sourceIndex - right.sourceIndex)
      .map(({ point, reason }) => ({ point, reason })),
  };
}
