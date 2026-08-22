import type { TrackPoint } from './types.js';

export const GPS_SMOOTHED_ELEVATION_SOURCE = 'gps_smoothed' as const;

export interface ElevationSample {
  readonly timestampMs: number;
  readonly elevationM: number;
}

export interface ElevationProfile {
  readonly source: typeof GPS_SMOOTHED_ELEVATION_SOURCE;
  readonly samples: readonly ElevationSample[];
  readonly gainM: number;
  readonly lossM: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return middleValue;
  return ((sorted[middle - 1] ?? middleValue) + middleValue) / 2;
}

export function smoothGpsElevation(
  points: readonly TrackPoint[],
  windowSize = 5,
): readonly ElevationSample[] {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize % 2 === 0) {
    throw new RangeError('windowSize must be a positive odd integer');
  }
  const altitudePoints = points.filter(
    (point): point is TrackPoint & { elevationM: number } =>
      point.elevationM != null && Number.isFinite(point.elevationM),
  );
  const radius = Math.floor(windowSize / 2);
  return altitudePoints.map((point, index) => {
    const local = altitudePoints
      .slice(Math.max(0, index - radius), index + radius + 1)
      .map((candidate) => candidate.elevationM);
    return { timestampMs: point.timestampMs, elevationM: median(local) };
  });
}

/** Accumulates only threshold-crossing changes, suppressing residual GPS jitter. */
export function elevationGainLoss(
  samples: readonly ElevationSample[],
  thresholdM = 3,
): { readonly gainM: number; readonly lossM: number } {
  if (thresholdM < 0 || !Number.isFinite(thresholdM)) {
    throw new RangeError('thresholdM must be finite and non-negative');
  }
  let gainM = 0;
  let lossM = 0;
  let anchor = samples[0]?.elevationM;
  if (anchor === undefined) return { gainM, lossM };
  for (const sample of samples.slice(1)) {
    const change = sample.elevationM - anchor;
    if (change >= thresholdM) {
      gainM += change;
      anchor = sample.elevationM;
    } else if (change <= -thresholdM) {
      lossM += -change;
      anchor = sample.elevationM;
    }
  }
  return { gainM, lossM };
}

export function buildSmoothedGpsElevationProfile(
  points: readonly TrackPoint[],
  options: {
    readonly windowSize?: number;
    readonly gainThresholdM?: number;
  } = {},
): ElevationProfile {
  const samples = smoothGpsElevation(points, options.windowSize ?? 5);
  const totals = elevationGainLoss(samples, options.gainThresholdM ?? 3);
  return { source: GPS_SMOOTHED_ELEVATION_SOURCE, samples, ...totals };
}
