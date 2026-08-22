import { describe, expect, it } from 'vitest';
import { processLocationBatch } from './location-pipeline';
import type { RecordingSession } from './recording-types';

const base: RecordingSession = {
  id: 's',
  ownerUserId: 'owner',
  state: 'recording',
  sport: 'run',
  backgroundEnabled: true,
  createdAtMs: 0,
  startedAtMs: 0,
  updatedAtMs: 0,
  stoppedAtMs: null,
  pausedAtMs: null,
  accumulatedPausedMs: 0,
  distanceM: 0,
  acceptedPointCount: 0,
  lastSequence: -1,
  latestRawAccuracyM: null,
  latestRawFixAtMs: null,
  stopReason: null,
  errorCode: null,
};
const point = (longitude: number, timestampMs: number, accuracyM = 5) => ({
  latitude: 0,
  longitude,
  timestampMs,
  accuracyM,
});

describe('shared location filter pipeline', () => {
  it('uses domain filtering for invalid order, poor accuracy, and impossible jumps', () => {
    const previous = point(0, 1_000);
    const result = processLocationBatch(base, previous, [
      point(0.00001, 2_000),
      point(1, 3_000),
      point(0.00002, 4_000, 80),
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.timestampMs).toBe(2_000);
    expect(result.distanceDeltaM).toBeGreaterThan(1);
  });
  it('retains only remaining capacity and reports the point cap instead of silently truncating', () => {
    const result = processLocationBatch(
      { ...base, acceptedPointCount: 99_999 },
      null,
      [point(0, 1_000), point(0.000001, 2_000)],
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.pointLimitReached).toBe(true);
  });
  it('allows a poor first fix while warning remains a presentation concern', () => {
    expect(
      processLocationBatch(base, null, [point(0, 1_000, 90)]).accepted,
    ).toHaveLength(1);
  });
});
