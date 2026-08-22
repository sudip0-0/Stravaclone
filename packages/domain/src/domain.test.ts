import { describe, expect, it } from 'vitest';
import {
  IMPERIAL_SPLIT_DISTANCE_M,
  METRIC_SPLIT_DISTANCE_M,
  buildSmoothedGpsElevationProfile,
  calculateActivityTimes,
  classifyAccuracy,
  downsampleForDisplay,
  encodePolyline,
  filterTrackPoints,
  generateSplits,
  haversineDistanceM,
  isImpossibleJump,
  isValidCoordinate,
  feetToMeters,
  isValidTrackPoint,
  kilometersToMeters,
  metersPerSecondToKilometersPerHour,
  metersPerSecondToMilesPerHour,
  metersToFeet,
  metersToKilometers,
  metersToMiles,
  milesToMeters,
  paceSecondsPerUnit,
  speedMetersPerSecond,
  trackDistanceM,
  type ElevationProvider,
  type TrackPoint,
} from './index.js';

const point = (
  latitude: number,
  longitude: number,
  timestampMs: number,
  accuracyM: number | null = 5,
  elevationM: number | null = 10,
): TrackPoint => ({ latitude, longitude, timestampMs, accuracyM, elevationM });

describe('coordinate, time, and distance validation', () => {
  it('validates coordinate boundaries and strictly increasing times', () => {
    for (const coordinate of [
      { latitude: -90, longitude: -180 },
      { latitude: 90, longitude: 180 },
      { latitude: 0, longitude: 0 },
    ]) {
      expect(isValidCoordinate(coordinate)).toBe(true);
    }
    expect(isValidCoordinate({ latitude: 90.0001, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: Number.NaN })).toBe(
      false,
    );
    expect(isValidTrackPoint(point(0, 0, 1000), point(0, 0, 1000))).toBe(false);
  });

  it('matches a known geodesic and sums consecutive segments', () => {
    const london = { latitude: 51.5074, longitude: -0.1278 };
    const paris = { latitude: 48.8566, longitude: 2.3522 };
    expect(haversineDistanceM(london, paris)).toBeCloseTo(343_556, -2);
    expect(trackDistanceM([london, paris, london])).toBeCloseTo(687_112, -2);
  });

  it('is symmetric and zero for generated coordinate fixtures', () => {
    for (let latitude = -80; latitude <= 80; latitude += 20) {
      const from = { latitude, longitude: latitude / 2 };
      const to = { latitude: latitude + 0.01, longitude: latitude / 2 + 0.02 };
      expect(haversineDistanceM(from, from)).toBe(0);
      expect(haversineDistanceM(from, to)).toBeCloseTo(
        haversineDistanceM(to, from),
        10,
      );
    }
  });
});

describe('accuracy and jump filtering', () => {
  it('classifies preferred, usable, poor, and unknown fixes', () => {
    expect([
      classifyAccuracy(20),
      classifyAccuracy(50),
      classifyAccuracy(50.1),
      classifyAccuracy(),
    ]).toEqual(['preferred', 'usable', 'poor', 'unknown']);
  });

  it('drops poor fixes when better fixes exist without mutating source', () => {
    const source = [
      point(0, 0, 0, 5),
      point(0, 0.00001, 1000, 80),
      point(0, 0.00002, 2000, 20),
    ];
    const snapshot = structuredClone(source);
    const filtered = filterTrackPoints(source, 'run');
    expect(filtered.accepted).toHaveLength(2);
    expect(filtered.rejected[0]?.reason).toBe('poor_accuracy');
    expect(source).toEqual(snapshot);
    expect(filtered.accepted[0]).not.toBe(source[0]);
  });

  it('preserves a chronological jump-filtered stream when every fix is poor', () => {
    const source = [
      point(51.5, -0.1, 0, 80),
      point(51.50004, -0.1, 1000, 70),
      point(51.51, -0.1, 2000, 60),
      point(51.50008, -0.1, 3000, 90),
    ];
    const filtered = filterTrackPoints(source, 'walk');
    expect(filtered.accepted.map(({ timestampMs }) => timestampMs)).toEqual([
      0, 1000, 3000,
    ]);
    expect(filtered.rejected).toEqual([
      { point: source[2], reason: 'impossible_jump' },
    ]);
  });

  it('deterministically filters an all-poor urban canyon fixture', () => {
    const urbanNoise = [
      point(40.7128, -74.006, 0, 65),
      point(40.71284, -74.006, 1000, 72),
      point(40.71288, -74.00601, 2000, 95),
      point(40.714, -74.006, 3000, 85),
      point(40.71292, -74.00601, 4000, 68),
    ];
    const first = filterTrackPoints(urbanNoise, 'run');
    const second = filterTrackPoints(urbanNoise, 'run');
    expect(first).toEqual(second);
    expect(first.accepted.map(({ timestampMs }) => timestampMs)).toEqual([
      0, 1000, 2000, 4000,
    ]);
    expect(first.rejected[0]?.reason).toBe('impossible_jump');
  });

  it('keeps a realistic fast ride stream while rejecting it for pedestrian sports', () => {
    const ride = [
      point(0, 0, 0, 8),
      point(0, 0.0002, 1000, 9),
      point(0, 0.0004, 2000, 10),
      point(0, 0.0006, 3000, 11),
    ];
    expect(filterTrackPoints(ride, 'ride').accepted).toHaveLength(4);
    expect(filterTrackPoints(ride, 'run').accepted).toHaveLength(1);
  });

  it('uses sport-specific impossible jump caps', () => {
    const from = point(0, 0, 0);
    const approximatelyTwentyMetersAway = point(0, 0.00018, 1000);
    expect(isImpossibleJump(from, approximatelyTwentyMetersAway, 'run')).toBe(
      true,
    );
    expect(isImpossibleJump(from, approximatelyTwentyMetersAway, 'ride')).toBe(
      false,
    );
  });
});

describe('pause and gap time', () => {
  it('separates elapsed, pause, moving, and unobserved gap time', () => {
    const points = [
      point(0, 0, 0),
      point(0, 0, 1000),
      point(0, 0, 6000),
      point(0, 0, 26_000),
    ];
    expect(
      calculateActivityTimes(
        0,
        30_000,
        points,
        [{ startedAtMs: 2000, endedAtMs: 5000 }],
        10,
      ),
    ).toEqual({
      elapsedTimeS: 30,
      movingTimeS: 3,
      pausedTimeS: 3,
      gapTimeS: 20,
    });
  });

  it('merges overlapping pauses rather than double counting', () => {
    const times = calculateActivityTimes(
      0,
      10_000,
      [point(0, 0, 0), point(0, 0, 10_000)],
      [
        { startedAtMs: 1000, endedAtMs: 5000 },
        { startedAtMs: 4000, endedAtMs: 8000 },
      ],
      20,
    );
    expect(times.pausedTimeS).toBe(7);
    expect(times.movingTimeS).toBe(3);
  });
});

describe('splits, pace, and speed', () => {
  it('interpolates metric boundaries and includes a pace-normalized partial split', () => {
    const splits = generateSplits(
      [
        { distanceM: 0, movingTimeS: 0 },
        { distanceM: 750, movingTimeS: 300 },
        { distanceM: 2500, movingTimeS: 1000 },
      ],
      'metric',
    );
    expect(splits).toHaveLength(3);
    expect(splits.map((split) => split.distanceM)).toEqual([1000, 1000, 500]);
    expect(splits[2]).toMatchObject({
      partial: true,
      movingTimeS: 200,
      paceSecondsPerUnit: 400,
    });
  });

  it('switches exactly at the imperial unit boundary', () => {
    const splits = generateSplits(
      [
        { distanceM: 0, movingTimeS: 0 },
        { distanceM: IMPERIAL_SPLIT_DISTANCE_M, movingTimeS: 480 },
      ],
      'imperial',
    );
    expect(splits).toEqual([
      {
        index: 1,
        distanceM: IMPERIAL_SPLIT_DISTANCE_M,
        movingTimeS: 480,
        paceSecondsPerUnit: 480,
        partial: false,
      },
    ]);
  });

  it('changes split boundaries deterministically with profile units', () => {
    const samples = [
      { distanceM: 0, movingTimeS: 0 },
      { distanceM: IMPERIAL_SPLIT_DISTANCE_M, movingTimeS: 600 },
    ];
    expect(
      generateSplits(samples, 'metric').map(({ distanceM }) => distanceM),
    ).toEqual([
      METRIC_SPLIT_DISTANCE_M,
      IMPERIAL_SPLIT_DISTANCE_M - METRIC_SPLIT_DISTANCE_M,
    ]);
    expect(
      generateSplits(samples, 'imperial').map(({ distanceM }) => distanceM),
    ).toEqual([IMPERIAL_SPLIT_DISTANCE_M]);
  });

  it('rejects malformed first, negative, non-finite, and non-monotonic samples', () => {
    for (const samples of [
      [{ distanceM: 1, movingTimeS: 0 }],
      [{ distanceM: 0, movingTimeS: 1 }],
      [{ distanceM: -1, movingTimeS: 0 }],
      [{ distanceM: 0, movingTimeS: Number.NaN }],
      [
        { distanceM: 0, movingTimeS: 0 },
        { distanceM: Number.POSITIVE_INFINITY, movingTimeS: 1 },
      ],
      [
        { distanceM: 0, movingTimeS: 0 },
        { distanceM: 10, movingTimeS: 2 },
        { distanceM: 9, movingTimeS: 3 },
      ],
      [
        { distanceM: 0, movingTimeS: 0 },
        { distanceM: 10, movingTimeS: 2 },
        { distanceM: 11, movingTimeS: 1 },
      ],
    ]) {
      expect(() => generateSplits(samples, 'metric')).toThrow(RangeError);
    }
  });

  it('converts speed, distance, and elevation units at exact boundaries', () => {
    expect(paceSecondsPerUnit(60, 0)).toBeNull();
    expect(speedMetersPerSecond(0, 100)).toBeNull();
    expect(speedMetersPerSecond(20, 100)).toBe(5);
    expect(metersPerSecondToKilometersPerHour(10)).toBe(36);
    expect(metersPerSecondToMilesPerHour(10)).toBeCloseTo(22.369_362_920_544);
    expect(metersToKilometers(1000)).toBe(1);
    expect(kilometersToMeters(1)).toBe(1000);
    expect(metersToMiles(IMPERIAL_SPLIT_DISTANCE_M)).toBe(1);
    expect(milesToMeters(1)).toBe(IMPERIAL_SPLIT_DISTANCE_M);
    expect(metersToFeet(1)).toBeCloseTo(3.280_839_895);
    expect(feetToMeters(metersToFeet(123.45))).toBeCloseTo(123.45, 12);
  });
});

describe('polyline and source-preserving display downsampling', () => {
  it('encodes the canonical Google polyline fixture', () => {
    expect(
      encodePolyline([
        { latitude: 38.5, longitude: -120.2 },
        { latitude: 40.7, longitude: -120.95 },
        { latitude: 43.252, longitude: -126.453 },
      ]),
    ).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(encodePolyline([])).toBe('');
  });

  it('keeps endpoints, bends, metadata, and source immutability', () => {
    const source = [
      { latitude: 0, longitude: 0, id: 1 },
      { latitude: 0, longitude: 0.0001, id: 2 },
      { latitude: 0.001, longitude: 0.0001, id: 3 },
      { latitude: 0.002, longitude: 0.0001, id: 4 },
    ] as const;
    const snapshot = structuredClone(source);
    const result = downsampleForDisplay(source, 5);
    expect(result.map(({ id }) => id)).toEqual([1, 2, 4]);
    expect(source).toEqual(snapshot);
    expect(result[0]).not.toBe(source[0]);
  });

  it('deterministically caps very large display tracks', () => {
    const source = Array.from({ length: 101 }, (_, index) => ({
      latitude: index % 2,
      longitude: index / 1000,
    }));
    const first = downsampleForDisplay(source, 0, 10);
    expect(first).toEqual(downsampleForDisplay(source, 0, 10));
    expect(first).toHaveLength(10);
    expect(first[0]).toEqual(source[0]);
    expect(first.at(-1)).toEqual(source.at(-1));
  });
});

describe('smoothed GPS elevation', () => {
  it('labels the source and suppresses flat-route GPS noise', () => {
    const elevations = [100, 102, 99, 101, 98, 100, 102];
    const source = elevations.map((elevation, index) =>
      point(0, index / 1000, index * 1000, 5, elevation),
    );
    const snapshot = structuredClone(source);
    const profile = buildSmoothedGpsElevationProfile(source);
    expect(profile.source).toBe('gps_smoothed');
    expect(profile.gainM).toBe(0);
    expect(profile.lossM).toBe(0);
    expect(source).toEqual(snapshot);
  });

  it('retains meaningful ascent after smoothing and ignores missing altitude', () => {
    const elevations = [100, 100, null, 101, 105, 110, 110];
    const profile = buildSmoothedGpsElevationProfile(
      elevations.map((elevation, index) =>
        point(0, 0, index * 1000, 5, elevation),
      ),
      { windowSize: 3, gainThresholdM: 3 },
    );
    expect(profile.samples).toHaveLength(6);
    expect(profile.gainM).toBeGreaterThanOrEqual(8);
  });

  it('defines a provider-neutral elevation port with positional results', async () => {
    const provider: ElevationProvider = {
      async getElevations({ points }) {
        return { elevationsM: points.map((_, index) => 100 + index) };
      },
    };
    await expect(
      provider.getElevations({
        points: [
          { latitude: 1, longitude: 2 },
          { latitude: 3, longitude: 4 },
        ],
      }),
    ).resolves.toEqual({ elevationsM: [100, 101] });
    expect('provider' in provider).toBe(false);
  });
});
