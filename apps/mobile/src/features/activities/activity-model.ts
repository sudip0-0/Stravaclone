import type { Activity, ActivitySummary, UnitSystem } from '@trail/contracts';
import {
  metersPerSecondToKilometersPerHour,
  metersPerSecondToMilesPerHour,
  metersToFeet,
  metersToKilometers,
  metersToMiles,
} from '@trail/domain';

export const MAX_ACTIVITY_LIST_ITEMS = 200;
export const MAX_ACTIVITY_MAP_POINTS = 1_000;
export interface ActivityLoadRequest {
  readonly cursor: string | undefined;
}
export class ActivityLoadQueue {
  private active = false;
  private queued: ActivityLoadRequest | null = null;
  begin(cursor?: string): boolean {
    if (!this.active) {
      this.active = true;
      return true;
    }
    if (cursor === undefined || this.queued === null) this.queued = { cursor };
    return false;
  }
  finish(): ActivityLoadRequest | null {
    this.active = false;
    const queued = this.queued;
    this.queued = null;
    return queued;
  }
}
export function mergeActivityRows<T extends { id: string; started_at: string }>(
  pending: readonly T[],
  remote: readonly T[],
): readonly T[] {
  return [
    ...new Map([...pending, ...remote].map((item) => [item.id, item])).values(),
  ]
    .sort(
      (left, right) =>
        Date.parse(right.started_at) - Date.parse(left.started_at),
    )
    .slice(0, MAX_ACTIVITY_LIST_ITEMS);
}
export function formatActivityDistance(
  distanceM: number,
  units: UnitSystem,
): string {
  return units === 'metric'
    ? `${metersToKilometers(distanceM).toFixed(2)} km`
    : `${metersToMiles(distanceM).toFixed(2)} mi`;
}
export function formatActivityDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}
export function formatActivitySpeed(
  speedMps: number | null,
  units: UnitSystem,
): string {
  if (speedMps === null) return '—';
  return units === 'metric'
    ? `${metersPerSecondToKilometersPerHour(speedMps).toFixed(1)} km/h`
    : `${metersPerSecondToMilesPerHour(speedMps).toFixed(1)} mph`;
}
export function formatActivityPace(
  secondsPerUnit: number | null,
  units: UnitSystem,
): string {
  if (secondsPerUnit === null) return '—';
  return `${formatActivityDuration(secondsPerUnit)} /${units === 'metric' ? 'km' : 'mi'}`;
}
export function formatElevation(meters: number, units: UnitSystem): string {
  return units === 'metric'
    ? `${Math.round(meters)} m`
    : `${Math.round(metersToFeet(meters))} ft`;
}
export function elevationLabel(activity: Pick<Activity, 'elevation'>): string {
  return activity.elevation.source === 'gps_smoothed'
    ? 'Elevation · GPS smoothed'
    : 'Elevation';
}
export function activityTitle(
  activity: Pick<ActivitySummary, 'title' | 'sport'>,
): string {
  return (
    activity.title ??
    `${activity.sport[0]?.toUpperCase()}${activity.sport.slice(1)}`
  );
}
export interface MapPoint {
  readonly latitude: number;
  readonly longitude: number;
}
export function decodeActivityPolyline(
  encoded: string,
  maximum = MAX_ACTIVITY_MAP_POINTS,
): readonly MapPoint[] {
  const values: MapPoint[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const decode = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error('Invalid polyline');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    latitude += decode();
    longitude += decode();
    values.push({
      latitude: latitude / 100_000,
      longitude: longitude / 100_000,
    });
  }
  if (values.length <= maximum) return values;
  const step = Math.ceil(values.length / (maximum - 1));
  return values
    .filter(
      (_, pointIndex) =>
        pointIndex === 0 ||
        pointIndex === values.length - 1 ||
        pointIndex % step === 0,
    )
    .slice(0, maximum - 1)
    .concat(values.at(-1)!);
}
export interface ActivityDisplayGeometry {
  readonly lineSegments: readonly (readonly MapPoint[])[];
  readonly singletonPoints: readonly MapPoint[];
  readonly pointCount: number;
  readonly degraded: boolean;
}
interface IndexedPoint {
  readonly segmentIndex: number;
  readonly pointIndex: number;
}
function evenlySpacedIndexes(length: number, count: number): readonly number[] {
  if (count <= 0 || length <= 0) return [];
  if (count === 1) return [0];
  return Array.from(
    new Set(
      Array.from({ length: count }, (_, index) =>
        Math.round((index * (length - 1)) / (count - 1)),
      ),
    ),
  );
}
/**
 * Applies one global point budget without ever joining pause-separated segments.
 * If all mandatory singleton/endpoints fit, every segment is represented and the
 * remaining budget samples interiors evenly. Otherwise representative segments
 * are selected evenly (first/last included), then spare slots admit deterministic
 * singleton or endpoint pairs in source order.
 */
export function buildActivityDisplayGeometry(
  encodedSegments: readonly string[],
  maximum = MAX_ACTIVITY_MAP_POINTS,
): ActivityDisplayGeometry {
  if (!Number.isInteger(maximum) || maximum < 1)
    throw new RangeError('maximum must be a positive integer');
  const decoded = encodedSegments.map((encoded) =>
    decodeActivityPolyline(encoded, Number.MAX_SAFE_INTEGER),
  );
  const mandatoryCost = decoded.reduce(
    (count, segment) => count + Math.min(2, segment.length),
    0,
  );
  const selected = new Map<number, Set<number>>();
  const includeSegmentEndpoints = (segmentIndex: number): number => {
    const segment = decoded[segmentIndex];
    if (!segment?.length || selected.has(segmentIndex)) return 0;
    const indexes =
      segment.length === 1 ? new Set([0]) : new Set([0, segment.length - 1]);
    selected.set(segmentIndex, indexes);
    return indexes.size;
  };

  if (mandatoryCost <= maximum) {
    decoded.forEach((_, index) => includeSegmentEndpoints(index));
    const interiors: IndexedPoint[] = decoded.flatMap((segment, segmentIndex) =>
      segment.slice(1, -1).map((_, index) => ({
        segmentIndex,
        pointIndex: index + 1,
      })),
    );
    const remaining = maximum - mandatoryCost;
    for (const index of evenlySpacedIndexes(
      interiors.length,
      Math.min(remaining, interiors.length),
    )) {
      const candidate = interiors[index];
      if (candidate)
        selected.get(candidate.segmentIndex)?.add(candidate.pointIndex);
    }
  } else {
    let remaining = maximum;
    const representativeCount = Math.min(
      decoded.length,
      Math.max(1, Math.floor(maximum / 2)),
    );
    for (const segmentIndex of evenlySpacedIndexes(
      decoded.length,
      representativeCount,
    )) {
      const cost = Math.min(2, decoded[segmentIndex]?.length ?? 0);
      if (cost <= remaining) remaining -= includeSegmentEndpoints(segmentIndex);
    }
    decoded.forEach((segment, segmentIndex) => {
      if (selected.has(segmentIndex)) return;
      const cost = Math.min(2, segment.length);
      if (cost > 0 && cost <= remaining) {
        remaining -= includeSegmentEndpoints(segmentIndex);
      }
    });
  }

  const selectedSegments = [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([segmentIndex, indexes]) =>
      [...indexes]
        .sort((left, right) => left - right)
        .map((pointIndex) => decoded[segmentIndex]?.[pointIndex])
        .filter((point): point is MapPoint => point !== undefined),
    );
  const lineSegments = selectedSegments.filter((segment) => segment.length > 1);
  const singletonPoints = selectedSegments
    .filter((segment) => segment.length === 1)
    .map((segment) => segment[0]!);
  const pointCount = selectedSegments.reduce(
    (count, segment) => count + segment.length,
    0,
  );
  return {
    lineSegments,
    singletonPoints,
    pointCount,
    degraded: mandatoryCost > maximum,
  };
}

export function activityGeometryGeoJson(geometry: ActivityDisplayGeometry) {
  const features: Array<
    | {
        type: 'Feature';
        properties: { kind: 'route' };
        geometry: { type: 'MultiLineString'; coordinates: number[][][] };
      }
    | {
        type: 'Feature';
        properties: { kind: 'singleton' };
        geometry: { type: 'MultiPoint'; coordinates: number[][] };
      }
  > = [];
  if (geometry.lineSegments.length)
    features.push({
      type: 'Feature',
      properties: { kind: 'route' },
      geometry: {
        type: 'MultiLineString',
        coordinates: geometry.lineSegments.map((segment) =>
          segment.map((point) => [point.longitude, point.latitude]),
        ),
      },
    });
  if (geometry.singletonPoints.length)
    features.push({
      type: 'Feature',
      properties: { kind: 'singleton' },
      geometry: {
        type: 'MultiPoint',
        coordinates: geometry.singletonPoints.map((point) => [
          point.longitude,
          point.latitude,
        ]),
      },
    });
  return { type: 'FeatureCollection' as const, features };
}
