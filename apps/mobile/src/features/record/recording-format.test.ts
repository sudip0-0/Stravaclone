import { describe, expect, it } from 'vitest';
import { formatCurrentMotion, formatDistance } from './recording-format';
const points = [
  { sequence: 0, latitude: 0, longitude: 0, timestampMs: 0 },
  { sequence: 1, latitude: 0, longitude: 0.000449, timestampMs: 10_000 },
];
describe('recording HUD unit and pace formatting', () => {
  it('uses profile units at presentation boundaries', () => {
    expect(formatDistance(1609.344, 'imperial')).toBe('1.00 mi');
    expect(formatDistance(1000, 'metric')).toBe('1.00 km');
    expect(formatCurrentMotion(points, 'ride', 'metric', 10_000)).toContain(
      'km/h',
    );
    expect(formatCurrentMotion(points, 'ride', 'imperial', 10_000)).toContain(
      'mph',
    );
  });
  it('carries rounded pace seconds instead of rendering M:60', () => {
    const nearCarry = [points[0]!, { ...points[1]!, longitude: 0.0001499 }];
    expect(formatCurrentMotion(nearCarry, 'run', 'metric', 10_000)).not.toMatch(
      /:60/,
    );
  });
  it('decays stale speed and pace', () => {
    expect(formatCurrentMotion(points, 'ride', 'metric', 20_001)).toBe(
      '0.0 km/h',
    );
    expect(formatCurrentMotion(points, 'run', 'imperial', 20_001)).toBe(
      '— min/mi',
    );
  });
});
