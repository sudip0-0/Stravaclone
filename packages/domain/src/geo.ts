import type { Coordinate, TrackPoint } from './types.js';

const EARTH_RADIUS_M = 6_371_008.8;
const DEGREES_TO_RADIANS = Math.PI / 180;

export function isValidCoordinate(point: Coordinate): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export function isValidTimestamp(timestampMs: number): boolean {
  return Number.isFinite(timestampMs) && timestampMs >= 0;
}

export function isValidTrackPoint(
  point: TrackPoint,
  previous?: TrackPoint,
): boolean {
  if (!isValidCoordinate(point) || !isValidTimestamp(point.timestampMs))
    return false;
  if (previous !== undefined && point.timestampMs <= previous.timestampMs)
    return false;
  if (
    point.accuracyM != null &&
    (!Number.isFinite(point.accuracyM) || point.accuracyM < 0)
  ) {
    return false;
  }
  return point.elevationM == null || Number.isFinite(point.elevationM);
}

/** Great-circle distance using the numerically stable haversine formula. */
export function haversineDistanceM(from: Coordinate, to: Coordinate): number {
  const latitudeDelta = (to.latitude - from.latitude) * DEGREES_TO_RADIANS;
  const longitudeDelta = (to.longitude - from.longitude) * DEGREES_TO_RADIANS;
  const fromLatitude = from.latitude * DEGREES_TO_RADIANS;
  const toLatitude = to.latitude * DEGREES_TO_RADIANS;
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const a =
    sinLatitude * sinLatitude +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * sinLongitude * sinLongitude;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function trackDistanceM(points: readonly Coordinate[]): number {
  let distanceM = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous !== undefined && current !== undefined) {
      distanceM += haversineDistanceM(previous, current);
    }
  }
  return distanceM;
}
