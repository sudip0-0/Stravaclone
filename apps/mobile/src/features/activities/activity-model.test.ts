import { encodePolyline } from '@trail/domain';
import { describe, expect, it } from 'vitest';
import {
  ActivityLoadQueue,
  activityGeometryGeoJson,
  buildActivityDisplayGeometry,
  elevationLabel,
  formatActivityDistance,
  formatActivityPace,
  formatActivitySpeed,
  formatElevation,
  mergeActivityRows,
} from './activity-model';

describe('activity presentation model', () => {
  it('formats canonical SI distance using current profile units', () => {
    expect(formatActivityDistance(1609.344, 'metric')).toBe('1.61 km');
    expect(formatActivityDistance(1609.344, 'imperial')).toBe('1.00 mi');
    expect(formatActivitySpeed(10, 'metric')).toBe('36.0 km/h');
    expect(formatActivitySpeed(10, 'imperial')).toBe('22.4 mph');
    expect(formatActivityPace(300, 'metric')).toBe('5:00 /km');
    expect(formatElevation(100, 'imperial')).toBe('328 ft');
    expect(formatActivityDistance(1609.344, 'metric', 'de-DE')).toBe('1,61 km');
    expect(formatActivitySpeed(10, 'metric', 'de-DE')).toBe('36,0 km/h');
  });
  it('shows pending rows first by chronology, deduplicates synced IDs, and supports empty state data', () => {
    const old = { id: 'old', started_at: '2026-01-01T00:00:00Z' };
    const pending = { id: 'pending', started_at: '2026-01-02T00:00:00Z' };
    expect(
      mergeActivityRows([pending], [old, pending]).map((row) => row.id),
    ).toEqual(['pending', 'old']);
    expect(mergeActivityRows([], [])).toEqual([]);
    const twoHundredFifty = Array.from({ length: 250 }, (_, index) => ({
      id: `row-${index}`,
      started_at: new Date(1_700_000_000_000 + index).toISOString(),
    }));
    const bounded = mergeActivityRows([], twoHundredFifty);
    expect(bounded).toHaveLength(200);
    expect(new Set(bounded.map((row) => row.id)).size).toBe(200);
  });
  it('labels elevation truthfully as GPS smoothed', () => {
    expect(
      elevationLabel({
        elevation: {
          source: 'gps_smoothed',
          samples: [],
          gain_m: 0,
          loss_m: 0,
        },
      }),
    ).toBe('Elevation · GPS smoothed');
  });
  it('represents singleton pause segments as points and emits valid GeoJSON', () => {
    const geometry = buildActivityDisplayGeometry([
      encodePolyline([{ latitude: 0, longitude: 0 }]),
      encodePolyline([
        { latitude: 1, longitude: 1 },
        { latitude: 1, longitude: 1.001 },
      ]),
    ]);
    expect(geometry.singletonPoints).toEqual([{ latitude: 0, longitude: 0 }]);
    expect(geometry.lineSegments).toHaveLength(1);
    const geoJson = activityGeometryGeoJson(geometry);
    expect(geoJson.type).toBe('FeatureCollection');
    expect(geoJson.features.map((feature) => feature.geometry.type)).toEqual([
      'MultiLineString',
      'MultiPoint',
    ]);
    expect(
      geoJson.features.every((feature) =>
        feature.geometry.type === 'MultiLineString'
          ? feature.geometry.coordinates.every((line) => line.length >= 2)
          : feature.geometry.coordinates.every(
              (coordinate) => coordinate.length === 2,
            ),
      ),
    ).toBe(true);
  });
  it('uses one global budget while preserving every short-segment endpoint', () => {
    const sources = Array.from({ length: 400 }, (_, segment) => [
      { latitude: segment / 10_000, longitude: 0 },
      { latitude: segment / 10_000, longitude: 0.001 },
      { latitude: segment / 10_000, longitude: 0.002 },
    ]);
    const geometry = buildActivityDisplayGeometry(
      sources.map((source) => encodePolyline(source)),
    );
    expect(geometry.pointCount).toBeLessThanOrEqual(1_000);
    expect(geometry.lineSegments).toHaveLength(400);
    geometry.lineSegments.forEach((segment, index) => {
      expect(segment[0]).toEqual(sources[index]?.[0]);
      expect(segment.at(-1)).toEqual(sources[index]?.at(-1));
    });
    expect(geometry.degraded).toBe(false);
  });
  it('degrades deterministically when mandatory segment representations exceed the budget', () => {
    const sources = Array.from({ length: 1_200 }, (_, index) => ({
      latitude: index / 100_000,
      longitude: index / 100_000,
    }));
    const encoded = sources.map((point) => encodePolyline([point]));
    const first = buildActivityDisplayGeometry(encoded);
    const second = buildActivityDisplayGeometry(encoded);
    expect(first).toEqual(second);
    expect(first.pointCount).toBe(1_000);
    expect(first.singletonPoints[0]).toEqual(sources[0]);
    expect(first.singletonPoints).toContainEqual(sources.at(-1));
    expect(first.lineSegments).toEqual([]);
    expect(first.degraded).toBe(true);
  });
  it('bounds a long segment to 1,000 points while preserving endpoints', () => {
    const source = Array.from({ length: 5_001 }, (_, index) => ({
      latitude: index / 100_000,
      longitude: index / 100_000,
    }));
    const geometry = buildActivityDisplayGeometry([encodePolyline(source)]);
    expect(geometry.pointCount).toBeLessThanOrEqual(1_000);
    expect(geometry.lineSegments[0]?.[0]).toEqual(source[0]);
    expect(geometry.lineSegments[0]?.at(-1)).toEqual(source.at(-1));
  });
  it('queues exactly one follow-up list load and lets refresh override pagination', () => {
    const queue = new ActivityLoadQueue();
    expect(queue.begin()).toBe(true);
    expect(queue.begin('page-2')).toBe(false);
    expect(queue.begin()).toBe(false);
    expect(queue.begin('page-3')).toBe(false);
    expect(queue.finish()).toEqual({ cursor: undefined });
    expect(queue.begin()).toBe(true);
    expect(queue.finish()).toBeNull();
  });
});
