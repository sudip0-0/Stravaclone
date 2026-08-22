import {
  filterTrackPoints,
  haversineDistanceM,
  type TrackPoint,
} from '@trail/domain';
import { MAX_RECORDING_POINTS, type RecordingSession } from './recording-types';

export interface PipelineResult {
  readonly accepted: readonly TrackPoint[];
  readonly distanceDeltaM: number;
  readonly pointLimitReached: boolean;
}

/** Uses the shared Phase 1 validation/accuracy/jump rules incrementally. */
export function processLocationBatch(
  session: RecordingSession,
  previousAccepted: TrackPoint | null,
  incoming: readonly TrackPoint[],
): PipelineResult {
  const accepted: TrackPoint[] = [];
  let anchor = previousAccepted;
  for (const point of incoming) {
    const candidates = anchor ? [anchor, point] : [point];
    const filtered = filterTrackPoints(candidates, session.sport).accepted;
    const acceptedPoint = filtered.some(
      (candidate) =>
        candidate.timestampMs === point.timestampMs &&
        candidate.latitude === point.latitude &&
        candidate.longitude === point.longitude,
    );
    if (acceptedPoint) {
      accepted.push(point);
      anchor = point;
    }
  }

  const remaining = Math.max(
    0,
    MAX_RECORDING_POINTS - session.acceptedPointCount,
  );
  const retained = accepted.slice(0, remaining);
  let distanceDeltaM = 0;
  let previous = previousAccepted;
  for (const point of retained) {
    if (previous) distanceDeltaM += haversineDistanceM(previous, point);
    previous = point;
  }
  return {
    accepted: retained,
    distanceDeltaM,
    pointLimitReached:
      accepted.length > remaining ||
      session.acceptedPointCount + retained.length >= MAX_RECORDING_POINTS,
  };
}
