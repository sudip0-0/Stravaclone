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
function decimal(value: number, locale: string, digits: number): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
export function formatDistance(
  distanceM: number,
  units: UnitSystem,
  locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
): string {
  return units === 'imperial'
    ? `${decimal(distanceM / METRES_PER_MILE, locale, 2)} mi`
    : `${decimal(distanceM / 1000, locale, 2)} km`;
}
export function formatAccuracy(
  accuracyM: number,
  units: UnitSystem,
  locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
): string {
  const value = units === 'imperial' ? accuracyM * 3.28084 : accuracyM;
  return `±${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} ${units === 'imperial' ? 'ft' : 'm'}`;
}
export function formatCurrentMotion(
  points: readonly SequencedPoint[],
  sport: ActivitySport,
  units: UnitSystem,
  nowMs: number,
  locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
): string {
  const previous = points.at(-2);
  const current = points.at(-1);
  const speedUnit = units === 'imperial' ? 'mph' : 'km/h';
  const paceUnit = units === 'imperial' ? 'min/mi' : 'min/km';
  if (!previous || !current || nowMs - current.timestampMs > 10_000)
    return sport === 'ride'
      ? `${decimal(0, locale, 1)} ${speedUnit}`
      : `— ${paceUnit}`;
  const seconds = (current.timestampMs - previous.timestampMs) / 1000;
  const metres = haversineDistanceM(previous, current);
  if (seconds <= 0 || metres <= 0)
    return sport === 'ride'
      ? `${decimal(0, locale, 1)} ${speedUnit}`
      : `— ${paceUnit}`;
  const metresPerSecond = metres / seconds;
  if (sport === 'ride')
    return units === 'imperial'
      ? `${decimal(metresPerSecond * 2.236936, locale, 1)} mph`
      : `${decimal(metresPerSecond * 3.6, locale, 1)} km/h`;
  return `${clockPace((units === 'imperial' ? METRES_PER_MILE : 1000) / metresPerSecond)} ${paceUnit}`;
}
