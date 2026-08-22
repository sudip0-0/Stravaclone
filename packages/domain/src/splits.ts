import { paceSecondsPerUnit } from './metrics.js';
import type { UnitSystem } from './types.js';
import { METERS_PER_KILOMETER, METERS_PER_MILE } from './units.js';

export const METRIC_SPLIT_DISTANCE_M = METERS_PER_KILOMETER;
export const IMPERIAL_SPLIT_DISTANCE_M = METERS_PER_MILE;

export interface SplitSample {
  readonly distanceM: number;
  readonly movingTimeS: number;
}

export interface ActivitySplit {
  readonly index: number;
  readonly distanceM: number;
  readonly movingTimeS: number;
  readonly paceSecondsPerUnit: number | null;
  readonly partial: boolean;
}

function interpolateTimeAtDistance(
  previous: SplitSample,
  current: SplitSample,
  distanceM: number,
): number {
  const segmentDistance = current.distanceM - previous.distanceM;
  if (segmentDistance <= 0) return current.movingTimeS;
  const fraction = (distanceM - previous.distanceM) / segmentDistance;
  return (
    previous.movingTimeS +
    fraction * (current.movingTimeS - previous.movingTimeS)
  );
}

function validateSplitSamples(samples: readonly SplitSample[]): void {
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (
      sample === undefined ||
      !Number.isFinite(sample.distanceM) ||
      !Number.isFinite(sample.movingTimeS) ||
      sample.distanceM < 0 ||
      sample.movingTimeS < 0
    ) {
      throw new RangeError('Split samples must be finite and non-negative');
    }
    const previous = samples[index - 1];
    if (
      previous !== undefined &&
      (sample.distanceM < previous.distanceM ||
        sample.movingTimeS < previous.movingTimeS)
    ) {
      throw new RangeError('Split samples must be monotonic');
    }
  }
  const first = samples[0];
  if (
    first !== undefined &&
    (first.distanceM !== 0 || first.movingTimeS !== 0)
  ) {
    throw new RangeError('Split samples must start at zero distance and time');
  }
}

/** Generates exact unit boundaries and always includes a non-zero final partial split. */
export function generateSplits(
  samples: readonly SplitSample[],
  units: UnitSystem,
): readonly ActivitySplit[] {
  validateSplitSamples(samples);
  if (samples.length < 2) return [];
  const unitDistanceM =
    units === 'metric' ? METRIC_SPLIT_DISTANCE_M : IMPERIAL_SPLIT_DISTANCE_M;
  const splits: ActivitySplit[] = [];
  let splitStartDistanceM = 0;
  let splitStartTimeS = samples[0]?.movingTimeS ?? 0;
  let nextBoundaryM = unitDistanceM;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous === undefined || current === undefined) continue;
    while (current.distanceM >= nextBoundaryM) {
      const boundaryTimeS = interpolateTimeAtDistance(
        previous,
        current,
        nextBoundaryM,
      );
      const distanceM = nextBoundaryM - splitStartDistanceM;
      const movingTimeS = boundaryTimeS - splitStartTimeS;
      splits.push({
        index: splits.length + 1,
        distanceM,
        movingTimeS,
        paceSecondsPerUnit: paceSecondsPerUnit(
          movingTimeS,
          distanceM,
          unitDistanceM,
        ),
        partial: false,
      });
      splitStartDistanceM = nextBoundaryM;
      splitStartTimeS = boundaryTimeS;
      nextBoundaryM += unitDistanceM;
    }
  }

  const last = samples.at(-1);
  if (last !== undefined && last.distanceM > splitStartDistanceM) {
    const distanceM = last.distanceM - splitStartDistanceM;
    const movingTimeS = last.movingTimeS - splitStartTimeS;
    splits.push({
      index: splits.length + 1,
      distanceM,
      movingTimeS,
      paceSecondsPerUnit: paceSecondsPerUnit(
        movingTimeS,
        distanceM,
        unitDistanceM,
      ),
      partial: true,
    });
  }
  return splits;
}
