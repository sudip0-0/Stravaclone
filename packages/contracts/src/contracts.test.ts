import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MAX_ACTIVITY_DURATION_SECONDS,
  MAX_ACTIVITY_POINTS,
  MAX_ACTIVITY_PHOTOS,
  MAX_PHOTO_INPUT_BYTES,
  MIN_SAVE_DISTANCE_METERS,
  MIN_SAVE_DURATION_SECONDS,
  SAVE_ELIGIBILITY_POLICY,
  activityPhotoSchema,
  activityPhotosSchema,
  activityPointsSchema,
  activitySchema,
  activitySplitSchema,
  authResponseSchema,
  calendarQuerySchema,
  calendarResponseSchema,
  createActivityRequestSchema,
  createRouteRequestSchema,
  cursorPageSchema,
  cursorPaginationQuerySchema,
  errorEnvelopeSchema,
  healthResponseSchema,
  identityLoginRequestSchema,
  loginRequestSchema,
  initiatePhotoUploadRequestSchema,
  readinessResponseSchema,
  refreshSessionRequestSchema,
  registerConfirmRequestSchema,
  registerRequestSchema,
  routeSchema,
  signedPhotoUploadSchema,
  statsQuerySchema,
  statsResponseSchema,
  updateActivityRequestSchema,
  updateUserRequestSchema,
  userSchema,
} from './index.js';

const id = '123e4567-e89b-42d3-a456-426614174000';
const secondId = '123e4567-e89b-42d3-a456-426614174001';
const startedAt = '2026-01-01T10:00:00.000Z';
const endedAt = '2026-01-01T10:01:00.000Z';

const basePoint = {
  sequence: 0,
  latitude: 51.5,
  longitude: -0.1,
  elevation_m: 20,
  accuracy_m: 5,
  recorded_at: startedAt,
};

const baseActivityRequest = {
  payload_version: 1,
  id,
  sport: 'run',
  started_at: startedAt,
  ended_at: endedAt,
  pauses: [],
  points: [basePoint],
};

const baseStats = {
  distance_m: 1000,
  moving_time_s: 300,
  elapsed_time_s: 320,
  elevation_gain_m: 12,
  elevation_loss_m: 8,
  average_pace_s_per_km: 300,
  average_speed_mps: 10 / 3,
};

const baseActivity = {
  id,
  sport: 'run',
  title: 'Morning Run',
  notes: null,
  started_at: startedAt,
  ended_at: endedAt,
  route_id: null,
  stats: baseStats,
  polylines: ['_p~iF~ps|U'],
  splits: [
    {
      index: 1,
      unit_system: 'metric',
      distance_m: 1000,
      moving_time_s: 300,
      pace_s_per_unit: 300,
      partial: false,
    },
  ],
  elevation: {
    source: 'gps_smoothed',
    samples: [{ distance_m: 0, elapsed_time_s: 0, elevation_m: 20 }],
    gain_m: 12,
    loss_m: 8,
  },
  created_at: endedAt,
  updated_at: endedAt,
};

const basePhoto = {
  id,
  activity_id: secondId,
  status: 'ready',
  mime: 'image/jpeg',
  size_bytes: 1024,
  width: 1200,
  height: 800,
  user_approved_latitude: null,
  user_approved_longitude: null,
  user_approved_captured_at: null,
  sort_order: 0,
  error_code: null,
  download_url: 'https://example.test/photo',
  download_expires_at: endedAt,
};

function expectJsonRoundTrip<T>(schema: z.ZodType<T>, value: unknown): void {
  const parsed = schema.parse(value);
  expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
}

describe('shared limits and primitives', () => {
  it('exposes exact fixed Phase 1 limits and OR save policy', () => {
    expect(MAX_ACTIVITY_DURATION_SECONDS).toBe(43_200);
    expect(MAX_ACTIVITY_POINTS).toBe(100_000);
    expect(MAX_ACTIVITY_PHOTOS).toBe(10);
    expect(MAX_PHOTO_INPUT_BYTES).toBe(10_485_760);
    expect(SAVE_ELIGIBILITY_POLICY).toBe('duration_or_distance');
    expect(MIN_SAVE_DURATION_SECONDS).toBe(30);
    expect(MIN_SAVE_DISTANCE_METERS).toBe(50);
  });
});

describe('auth and user contracts', () => {
  it('covers registration, password login, identity login, and refresh requests', () => {
    expect(
      registerRequestSchema.parse({
        email: 'Person@Example.COM',
        password: 'correct horse',
        display_name: 'Runner',
      }).email,
    ).toBe('person@example.com');
    expect(
      loginRequestSchema.safeParse({ email: 'a@b.com', password: 'x' }).success,
    ).toBe(true);
    expect(
      registerConfirmRequestSchema.safeParse({
        token: 'a'.repeat(43),
      }).success,
    ).toBe(true);
    expect(
      identityLoginRequestSchema.safeParse({ identity_token: 'verified-token' })
        .success,
    ).toBe(false);
    expect(
      identityLoginRequestSchema.safeParse({
        identity_token: 'verified-token',
        nonce: '0123456789abcdef',
      }).success,
    ).toBe(true);
    expect(
      refreshSessionRequestSchema.safeParse({
        refresh_token: 'opaque-token',
        rotation_request_id: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(true);
    expect(
      registerRequestSchema.safeParse({
        email: 'person@example.com',
        password: 'short',
        display_name: 'Runner',
        admin: true,
      }).success,
    ).toBe(false);
  });

  it('requires a non-empty user patch', () => {
    expect(updateUserRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateUserRequestSchema.safeParse({ units: 'imperial' }).success,
    ).toBe(true);
  });

  it('round-trips auth and user responses through JSON', () => {
    expectJsonRoundTrip(authResponseSchema, {
      user_id: id,
      session: {
        access_token: 'access',
        access_token_expires_at: endedAt,
        refresh_token: 'refresh',
        refresh_token_expires_at: '2026-02-01T10:00:00.000Z',
        token_type: 'Bearer',
      },
    });
    expectJsonRoundTrip(userSchema, {
      id,
      email: 'person@example.com',
      display_name: 'Runner',
      avatar_url: null,
      units: 'metric',
      default_sport: 'run',
      identities: [
        { id: secondId, provider: 'password', created_at: startedAt },
      ],
      created_at: startedAt,
      updated_at: endedAt,
    });
  });
});

describe('activity contracts', () => {
  it('accepts nullable persisted accuracy and an ordered bounded activity', () => {
    expect(
      createActivityRequestSchema.safeParse({
        ...baseActivityRequest,
        points: [{ ...basePoint, accuracy_m: null }],
      }).success,
    ).toBe(true);
  });

  it('treats the point limit as a count, not a sequence-value ceiling', () => {
    expect(
      createActivityRequestSchema.safeParse({
        ...baseActivityRequest,
        points: [
          { ...basePoint, sequence: 1_000_000_000 },
          {
            ...basePoint,
            sequence: 2_000_000_000,
            recorded_at: '2026-01-01T10:00:01.000Z',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('requires ended_at to be strictly after started_at and caps duration', () => {
    expect(
      createActivityRequestSchema.safeParse({
        ...baseActivityRequest,
        ended_at: startedAt,
      }).success,
    ).toBe(false);
    expect(
      createActivityRequestSchema.safeParse({
        ...baseActivityRequest,
        ended_at: new Date(
          Date.parse(startedAt) + (MAX_ACTIVITY_DURATION_SECONDS + 1) * 1000,
        ).toISOString(),
      }).success,
    ).toBe(false);
  });

  it('rejects invalid coordinates, point order, and out-of-bounds timestamps', () => {
    const result = createActivityRequestSchema.safeParse({
      ...baseActivityRequest,
      points: [
        { ...basePoint, latitude: 91, sequence: 2 },
        { ...basePoint, sequence: 1, recorded_at: '2026-01-01T10:02:00.000Z' },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
        expect.arrayContaining([
          'points.0.latitude',
          'points.1.sequence',
          'points.1.recorded_at',
        ]),
      );
    }
  });

  it('enforces exact 100,000/100,001 point boundaries at the shared array schema', () => {
    const exactLimit = Array.from(
      { length: MAX_ACTIVITY_POINTS },
      () => basePoint,
    );
    expect(activityPointsSchema.safeParse(exactLimit).success).toBe(true);
    expect(
      activityPointsSchema.safeParse([...exactLimit, basePoint]).success,
    ).toBe(false);
  });

  it('validates ordered non-overlapping pauses within activity bounds', () => {
    expect(
      createActivityRequestSchema.safeParse({
        ...baseActivityRequest,
        pauses: [
          { started_at: startedAt, ended_at: endedAt },
          { started_at: startedAt, ended_at: endedAt },
        ],
      }).success,
    ).toBe(false);
    expect(
      createActivityRequestSchema.safeParse({
        ...baseActivityRequest,
        pauses: [{ started_at: startedAt, ended_at: endedAt }],
      }).success,
    ).toBe(true);
  });
  it('requires one-based split indices', () => {
    expect(activitySplitSchema.safeParse(baseActivity.splits[0]).success).toBe(
      true,
    );
    expect(
      activitySplitSchema.safeParse({ ...baseActivity.splits[0], index: 0 })
        .success,
    ).toBe(false);
  });

  it('round-trips activity responses with generated or null persisted titles', () => {
    expectJsonRoundTrip(activitySchema, baseActivity);
    expectJsonRoundTrip(activitySchema, { ...baseActivity, title: null });
    expect(updateActivityRequestSchema.safeParse({ title: null }).success).toBe(
      true,
    );
  });

  it('validates activity response time ranges', () => {
    expect(
      activitySchema.safeParse({ ...baseActivity, ended_at: startedAt })
        .success,
    ).toBe(false);
  });
});

describe('route contracts', () => {
  it('uses latitude/longitude waypoint names consistently', () => {
    const request = {
      id,
      name: 'River Loop',
      waypoints: [
        { latitude: 51.5, longitude: -0.1 },
        { latitude: 51.51, longitude: -0.11 },
      ],
    };
    expect(createRouteRequestSchema.safeParse(request).success).toBe(true);
    expect(
      createRouteRequestSchema.safeParse({
        ...request,
        waypoints: [
          { lat: 51.5, lon: -0.1 },
          { lat: 51.51, lon: -0.11 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects one-point and unnamed routes and round-trips route responses', () => {
    expect(
      createRouteRequestSchema.safeParse({
        id,
        name: ' ',
        waypoints: [{ latitude: 0, longitude: 0 }],
      }).success,
    ).toBe(false);
    expectJsonRoundTrip(routeSchema, {
      id,
      name: 'River Loop',
      sport_hint: 'ride',
      waypoints: [
        { latitude: 51.5, longitude: -0.1 },
        { latitude: 51.51, longitude: -0.11 },
      ],
      polyline: 'encoded',
      distance_m: 2000,
      elevation_gain_m: null,
      created_at: startedAt,
      updated_at: endedAt,
    });
  });
});

describe('photo contracts', () => {
  it('enforces input size/content type and coordinate pairs', () => {
    expect(
      initiatePhotoUploadRequestSchema.safeParse({
        input_mime: 'image/jpeg',
        input_size_bytes: MAX_PHOTO_INPUT_BYTES,
        user_approved_latitude: 51.5,
        user_approved_longitude: -0.1,
      }).success,
    ).toBe(true);
    expect(
      initiatePhotoUploadRequestSchema.safeParse({
        input_mime: 'image/jpeg',
        input_size_bytes: 1,
        user_approved_latitude: 51.5,
      }).success,
    ).toBe(false);
    expect(
      initiatePhotoUploadRequestSchema.safeParse({
        input_mime: 'image/png',
        input_size_bytes: MAX_PHOTO_INPUT_BYTES + 1,
      }).success,
    ).toBe(false);
    expect(
      activityPhotoSchema.safeParse({
        ...basePhoto,
        user_approved_latitude: 51.5,
      }).success,
    ).toBe(false);
  });

  it('enforces exact 10/11 photo boundaries', () => {
    const exactLimit = Array.from(
      { length: MAX_ACTIVITY_PHOTOS },
      (_, sort_order) => ({
        ...basePhoto,
        sort_order,
      }),
    );
    expect(activityPhotosSchema.safeParse(exactLimit).success).toBe(true);
    expect(
      activityPhotosSchema.safeParse([...exactLimit, basePhoto]).success,
    ).toBe(false);
  });

  it('round-trips signed upload and activity photo responses', () => {
    expectJsonRoundTrip(signedPhotoUploadSchema, {
      photo_id: id,
      status: 'pending',
      upload_url: 'https://upload.example.test/object',
      expires_at: endedAt,
      form_fields: { 'Content-Type': 'image/jpeg', key: 'staging-key' },
    });
    expectJsonRoundTrip(activityPhotoSchema, basePhoto);
  });
});

describe('stats contracts', () => {
  const validQuery = {
    period: 'week',
    starts_at: startedAt,
    ends_at: endedAt,
    timezone: 'America/New_York',
  };

  it('requires a real IANA timezone and increasing time range', () => {
    expect(statsQuerySchema.safeParse(validQuery).success).toBe(true);
    expect(
      statsQuerySchema.safeParse({ ...validQuery, timezone: 'Not/A_Zone' })
        .success,
    ).toBe(false);
    expect(
      statsQuerySchema.safeParse({ ...validQuery, ends_at: startedAt }).success,
    ).toBe(false);
    expect(
      calendarQuerySchema.safeParse({
        year: 2026,
        month: 1,
        timezone: 'Europe/London',
      }).success,
    ).toBe(true);
    expect(
      calendarQuerySchema.safeParse({
        year: 2026,
        month: 1,
        timezone: '+02:00',
      }).success,
    ).toBe(false);
  });

  it('round-trips stats and calendar responses', () => {
    expectJsonRoundTrip(statsResponseSchema, {
      period: 'week',
      sport: 'all',
      starts_at: startedAt,
      ends_at: endedAt,
      totals: {
        distance_m: 1000,
        moving_time_s: 300,
        activity_count: 1,
        elevation_gain_m: 12,
      },
    });
    expectJsonRoundTrip(calendarResponseSchema, {
      days: [{ date: '2026-01-01', activity_count: 1 }],
    });
  });
});

describe('pagination, provider status, and errors', () => {
  it('coerces and bounds pagination and round-trips cursor pages', () => {
    expect(cursorPaginationQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(cursorPaginationQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expectJsonRoundTrip(cursorPageSchema(z.string()), {
      items: ['one'],
      page: { next_cursor: 'opaque', has_more: true },
    });
  });

  it('round-trips health/readiness responses without provider payloads', () => {
    expectJsonRoundTrip(healthResponseSchema, { status: 'ok' });
    expectJsonRoundTrip(readinessResponseSchema, {
      status: 'ready',
      providers: [{ kind: 'database', status: 'available' }],
    });
  });

  it('accepts stable error envelopes and rejects unknown codes', () => {
    expectJsonRoundTrip(errorEnvelopeSchema, {
      error: { code: 'too_many_points', message: 'Too many' },
    });
    expect(
      errorEnvelopeSchema.safeParse({
        error: { code: 'surprise', message: 'No' },
      }).success,
    ).toBe(false);
  });
});
