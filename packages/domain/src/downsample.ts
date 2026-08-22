import { haversineDistanceM } from './geo.js';
import type { Coordinate } from './types.js';

function perpendicularDistanceM(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
): number {
  const referenceLatitudeRadians = (start.latitude * Math.PI) / 180;
  const metersPerDegreeLatitude = 111_195;
  const metersPerDegreeLongitude =
    metersPerDegreeLatitude * Math.cos(referenceLatitudeRadians);
  const endX = (end.longitude - start.longitude) * metersPerDegreeLongitude;
  const endY = (end.latitude - start.latitude) * metersPerDegreeLatitude;
  const pointX = (point.longitude - start.longitude) * metersPerDegreeLongitude;
  const pointY = (point.latitude - start.latitude) * metersPerDegreeLatitude;
  const lengthSquared = endX * endX + endY * endY;
  if (lengthSquared === 0) return haversineDistanceM(point, start);
  const projection = Math.max(
    0,
    Math.min(1, (pointX * endX + pointY * endY) / lengthSquared),
  );
  return Math.hypot(pointX - projection * endX, pointY - projection * endY);
}

function douglasPeuckerIndices(
  points: readonly Coordinate[],
  toleranceM: number,
): number[] {
  if (points.length <= 2) return points.map((_, index) => index);
  const kept = new Set<number>([0, points.length - 1]);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (range === undefined) break;
    const [startIndex, endIndex] = range;
    const start = points[startIndex];
    const end = points[endIndex];
    if (start === undefined || end === undefined) continue;
    let furthestIndex = -1;
    let furthestDistance = toleranceM;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const point = points[index];
      if (point === undefined) continue;
      const distance = perpendicularDistanceM(point, start, end);
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestIndex = index;
      }
    }
    if (furthestIndex !== -1) {
      kept.add(furthestIndex);
      stack.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
    }
  }
  return [...kept].sort((left, right) => left - right);
}

function evenlyLimitIndices(
  indices: readonly number[],
  maxPoints: number,
): number[] {
  if (indices.length <= maxPoints) return [...indices];
  const selected: number[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    selected.push(
      indices[Math.round((index * (indices.length - 1)) / (maxPoints - 1))] ??
        0,
    );
  }
  return [...new Set(selected)];
}

/** Returns cloned source points; source order and source objects are never modified. */
export function downsampleForDisplay<T extends Coordinate>(
  source: readonly T[],
  toleranceM: number,
  maxPoints = 5000,
): readonly T[] {
  if (toleranceM < 0 || !Number.isFinite(toleranceM)) {
    throw new RangeError('toleranceM must be finite and non-negative');
  }
  if (!Number.isInteger(maxPoints) || maxPoints < 2) {
    throw new RangeError('maxPoints must be an integer of at least two');
  }
  const indices = evenlyLimitIndices(
    douglasPeuckerIndices(source, toleranceM),
    maxPoints,
  );
  return indices.map((index) => ({ ...source[index] }) as T);
}
