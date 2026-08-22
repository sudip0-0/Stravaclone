import type { Coordinate } from './types.js';

function encodeSigned(value: number): string {
  let encodedValue = value < 0 ? ~(value << 1) : value << 1;
  let output = '';
  while (encodedValue >= 0x20) {
    output += String.fromCharCode((0x20 | (encodedValue & 0x1f)) + 63);
    encodedValue >>>= 5;
  }
  return output + String.fromCharCode(encodedValue + 63);
}

/** Google encoded polyline algorithm, defaulting to five decimal places. */
export function encodePolyline(
  points: readonly Coordinate[],
  precision = 5,
): string {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new RangeError('precision must be an integer from 0 through 6');
  }
  const factor = 10 ** precision;
  let previousLatitude = 0;
  let previousLongitude = 0;
  let output = '';
  for (const point of points) {
    const latitude = Math.round(point.latitude * factor);
    const longitude = Math.round(point.longitude * factor);
    output += encodeSigned(latitude - previousLatitude);
    output += encodeSigned(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }
  return output;
}
