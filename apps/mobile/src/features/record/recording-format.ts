import {
  haversineDistanceM,
  type ActivitySport,
  type UnitSystem,
} from '@trail/domain';
import type { SequencedPoint } from './recording-types';

const METRES_PER_MILE = 1609.344;
function clockPace(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
export function formatDistance(distanceM: number, units: UnitSystem): string {
  return units === 'imperial'
    ? `${(distanceM / METRES_PER_MILE).toFixed(2)} mi`
    : `${(distanceM / 1000).toFixed(2)} km`;
}
export function formatCurrentMotion(
  points: readonly SequencedPoint[],
  sport: ActivitySport,
  units: UnitSystem,
  nowMs: number,
): string {
  const previous = points.at(-2);
  const current = points.at(-1);
  const speedUnit = units === 'imperial' ? 'mph' : 'km/h';
  const paceUnit = units === 'imperial' ? 'min/mi' : 'min/km';
  if (!previous || !current || nowMs - current.timestampMs > 10_000)
    return sport === 'ride' ? `0.0 ${speedUnit}` : `— ${paceUnit}`;
  const seconds = (current.timestampMs - previous.timestampMs) / 1000;
  const metres = haversineDistanceM(previous, current);
  if (seconds <= 0 || metres <= 0)
    return sport === 'ride' ? `0.0 ${speedUnit}` : `— ${paceUnit}`;
  const metresPerSecond = metres / seconds;
  if (sport === 'ride')
    return units === 'imperial'
      ? `${(metresPerSecond * 2.236936).toFixed(1)} mph`
      : `${(metresPerSecond * 3.6).toFixed(1)} km/h`;
  return `${clockPace((units === 'imperial' ? METRES_PER_MILE : 1000) / metresPerSecond)} ${paceUnit}`;
}
