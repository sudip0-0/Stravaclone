import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type {
  Activity,
  ActivityListResponse,
  CreateActivityRequest,
  ErrorEnvelope,
} from '@trail/contracts';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { signAccessToken } from '../src/auth/crypto.js';
import type { DependencyStatus, Providers } from '../src/providers/ports.js';
import { testConfig } from './fixtures.js';

const baseDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI === 'true' && !baseDatabaseUrl)
  throw new Error('TEST_DATABASE_URL is required for database tests in CI');
const suite = baseDatabaseUrl ? describe : describe.skip;
const migrationsFolder = fileURLToPath(
  new URL('../src/db/migrations', import.meta.url),
);
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
function payload(
  id = '00000000-0000-4000-8000-000000000201',
): CreateActivityRequest {
  return {
    payload_version: 1,
    id,
    sport: 'run',
    title: 'Morning run',
    notes: null,
    started_at: '2026-01-01T08:00:00.000Z',
    ended_at: '2026-01-01T08:00:20.000Z',
    route_id: null,
    pauses: [],
    points: [
      {
        sequence: 0,
        latitude: 0,
        longitude: 0,
        elevation_m: 10,
        accuracy_m: 3,
        recorded_at: '2026-01-01T08:00:00.000Z',
      },
      {
        sequence: 1,
        latitude: 0,
        longitude: 0.001,
        elevation_m: 15,
        accuracy_m: 3,
        recorded_at: '2026-01-01T08:00:10.000Z',
      },
      {
        sequence: 2,
        latitude: 0,
        longitude: 0.002,
        elevation_m: 11,
        accuracy_m: 3,
        recorded_at: '2026-01-01T08:00:20.000Z',
      },
    ],
  };
}
suite('Phase 4 activity API', () => {
  const databaseName = `trail_activity_test_${process.pid}_${Date.now()}`;
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof buildApp>;
  let ownerToken: string;
  let otherToken: string;
  const authorization = (token = ownerToken) => ({
    authorization: `Bearer ${token}`,
  });
  beforeAll(async () => {
    const url = new URL(baseDatabaseUrl!);
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    sql = postgres(url.toString(), { max: 8, onnotice: () => undefined });
    await migrate(drizzle(sql), { migrationsFolder });
    const checkHealth = async (): Promise<DependencyStatus> => 'up';
    const disabled = {
      enabled: false,
      verify: async () => Promise.reject(new Error('disabled')),
    };
    const providers: Providers = {
      database: { sql, checkHealth },
      identity: { apple: disabled, google: disabled },
      objectStorage: {
        bucket: 'test',
        checkHealth,
        presignPost: async () => ({
          url: 'https://example.test/upload',
          fields: {},
        }),
        presignGet: async () => 'https://example.test/download',
        head: async () => null,
        get: async () => Readable.from([]),
        put: async () => undefined,
        delete: async () => undefined,
      },
      email: { enabled: false, checkHealth, send: async () => undefined },
      mapStyle: { styleUrl: 'https://example.test' },
      elevation: {
        getElevations: async ({ points }) => ({
          elevationsM: points.map(() => null),
        }),
      },
      routing: { route: async () => Promise.reject(new Error('disabled')) },
      telemetry: { captureException: () => undefined },
      close: async () => undefined,
    };
    app = buildApp({
      config: { ...testConfig, BODY_LIMIT_BYTES: 33_554_432 },
      providers,
      logger: false,
    });
    await app.ready();
    ownerToken = (await signAccessToken(owner, 0, testConfig)).token;
    otherToken = (await signAccessToken(other, 0, testConfig)).token;
  });
  beforeEach(async () => {
    await sql`truncate trail.users cascade`;
    await sql`insert into trail.users (id,email,password_hash,display_name,units) values (${owner},'owner@example.test',null,'Owner','metric'),(${other},'other@example.test',null,'Other','imperial')`;
  });
  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`DROP DATABASE "${databaseName}"`);
    await admin.end();
  });
  async function create(input = payload(), token = ownerToken) {
    return app.inject({
      method: 'POST',
      url: '/v1/activities',
      headers: authorization(token),
      payload: input,
    });
  }
  it('recomputes canonical SI totals and returns an identical replay without duplicating retained points', async () => {
    const first = await create();
    expect(first.statusCode, first.body).toBe(201);
    const activity = first.json<Activity>();
    expect(activity.stats.distance_m).toBeCloseTo(222.39, 1);
    expect(activity.stats.moving_time_s).toBe(20);
    expect(activity.stats.elapsed_time_s).toBe(20);
    expect(activity.elevation.source).toBe('gps_smoothed');
    expect(activity.splits.at(-1)?.partial).toBe(true);
    const replay = await create();
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(activity);
    const counts = await sql<
      { count: number }[]
    >`select count(*)::int as count from trail.activity_points where activity_id=${payload().id}`;
    expect(counts[0]?.count).toBe(3);
  });
  it('keeps canonical idempotency stable across presentation and profile-unit changes', async () => {
    const input = payload();
    expect((await create(input)).statusCode).toBe(201);
    await app.inject({
      method: 'PATCH',
      url: `/v1/activities/${input.id}`,
      headers: authorization(),
      payload: { title: 'Server edited title', notes: 'edited notes' },
    });
    await sql`update trail.users set units='imperial' where id=${owner}`;
    const replay = await create({
      ...input,
      title: 'Different presentation',
      notes: null,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json<Activity>().title).toBe('Server edited title');
  });
  it('excludes pause crossings from moving time, distance, and splits without phantom distance', async () => {
    for (const [durationMs, expectedMoving] of [
      [2_000, 10],
      [8_000, 10],
    ] as const) {
      const input = payload(randomUUID());
      input.pauses = [
        {
          started_at: new Date(
            Date.parse(input.started_at) + 10_000,
          ).toISOString(),
          ended_at: new Date(
            Date.parse(input.started_at) + 10_000 + durationMs,
          ).toISOString(),
        },
      ];
      const response = await create(input);
      expect(response.statusCode, response.body).toBe(201);
      const activity = response.json<Activity>();
      expect(activity.stats.distance_m).toBeCloseTo(111.2, 1);
      expect(activity.stats.moving_time_s).toBe(expectedMoving);
      expect(activity.splits[0]?.distance_m).toBeCloseTo(111.2, 1);
      expect(activity.polylines).toHaveLength(2);
      expect(activity.elevation.gain_m).toBe(0);
    }
  });
  it('rejects changed owner replay and cross-owner UUID collisions opaquely without overwrite', async () => {
    expect((await create()).statusCode).toBe(201);
    const changed = payload();
    changed.points[1] = { ...changed.points[1]!, longitude: 0.01 };
    const conflict = await create(changed);
    const crossOwner = await create(payload(), otherToken);
    expect(conflict.statusCode).toBe(409);
    expect(crossOwner.statusCode).toBe(409);
    expect(conflict.json<ErrorEnvelope>().error).toEqual(
      crossOwner.json<ErrorEnvelope>().error,
    );
    const row = await sql<
      { title: string }[]
    >`select title from trail.activities where id=${payload().id}`;
    expect(row[0]?.title).toBe('Morning run');
  });
  it('rejects unauthenticated oversized malformed JSON in onRequest before body parsing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/activities',
      headers: { 'content-type': 'application/json' },
      payload: `{"points":[${'0,'.repeat(2_000_000)}`,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorEnvelope>().error.code).toBe('unauthorized');
  });
  it('returns stable 413 for 100,001 points before contract validation', async () => {
    const input = payload(randomUUID());
    input.ended_at = '2026-01-01T08:02:00.000Z';
    input.points = Array.from({ length: 100_001 }, (_, index) => ({
      sequence: index,
      latitude: 0,
      longitude: 0,
      elevation_m: null,
      accuracy_m: null,
      recorded_at: new Date(Date.parse(input.started_at) + index).toISOString(),
    }));
    const response = await create(input);
    expect(response.statusCode).toBe(413);
    expect(response.json<ErrorEnvelope>().error.code).toBe('too_many_points');
  }, 30_000);
  it('accepts and persists the measured 100,000-point boundary', async () => {
    const input = payload(randomUUID());
    input.ended_at = '2026-01-01T08:02:00.000Z';
    input.pauses = Array.from({ length: 10_000 }, (_, index) => ({
      started_at: new Date(
        Date.parse(input.started_at) + index * 10 + 1,
      ).toISOString(),
      ended_at: new Date(
        Date.parse(input.started_at) + index * 10 + 2,
      ).toISOString(),
    }));
    input.points = Array.from({ length: 100_000 }, (_, index) => ({
      sequence: index,
      latitude: 0,
      longitude: index / 1_000_000_000,
      elevation_m: null,
      accuracy_m: null,
      recorded_at: new Date(Date.parse(input.started_at) + index).toISOString(),
    }));
    const started = Date.now();
    const response = await create(input);
    expect(response.statusCode, response.body).toBe(201);
    const rows = await sql<
      { count: number }[]
    >`select count(*)::int as count from trail.activity_points where activity_id=${input.id}`;
    expect(rows[0]?.count).toBe(100_000);
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 40_000);
  it('enforces route ownership', async () => {
    const routeId = randomUUID();
    await sql`insert into trail.routes (id,user_id,name,waypoints,polyline,distance_m) values (${routeId},${other},'Private route',${JSON.stringify(
      [
        { latitude: 0, longitude: 0 },
        { latitude: 0.1, longitude: 0.1 },
      ],
    )}::jsonb,'??','1')`;
    const input = payload();
    input.route_id = routeId;
    expect((await create(input)).statusCode).toBe(404);
  });
  it('paginates in reverse chronology, updates only title/notes, isolates detail, and confirms delete', async () => {
    const first = payload(randomUUID());
    const second = payload(randomUUID());
    second.started_at = '2026-01-02T08:00:00.000Z';
    second.ended_at = '2026-01-02T08:00:20.000Z';
    second.points = second.points.map((point) => ({
      ...point,
      recorded_at: point.recorded_at.replace('01T', '02T'),
    }));
    await create(first);
    await create(second);
    const pageOne = await app.inject({
      method: 'GET',
      url: '/v1/activities?limit=1',
      headers: authorization(),
    });
    const one = pageOne.json<ActivityListResponse>();
    expect(one.items[0]?.id).toBe(second.id);
    expect(one.page.has_more).toBe(true);
    const pageTwo = await app.inject({
      method: 'GET',
      url: `/v1/activities?limit=1&cursor=${encodeURIComponent(one.page.next_cursor!)}`,
      headers: authorization(),
    });
    expect(pageTwo.json<ActivityListResponse>().items[0]?.id).toBe(first.id);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/activities/${first.id}`,
          headers: authorization(otherToken),
        })
      ).statusCode,
    ).toBe(404);
    const update = await app.inject({
      method: 'PATCH',
      url: `/v1/activities/${first.id}`,
      headers: authorization(),
      payload: { title: 'Renamed', notes: 'Private notes' },
    });
    expect(update.json<Activity>().title).toBe('Renamed');
    const photoId = randomUUID();
    const stagingObjectKey = `users/${owner}/activities/${first.id}/photos/${photoId}/staging`;
    const normalizedObjectKey = `users/${owner}/activities/${first.id}/photos/${photoId}/normalized`;
    await sql`insert into trail.activity_photos (id,activity_id,user_id,staging_object_key,normalized_object_key,sort_order) values (${photoId},${first.id},${owner},${stagingObjectKey},${normalizedObjectKey},0)`;
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/activities/${first.id}`,
          headers: authorization(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/activities/${first.id}?confirmation=DELETE`,
          headers: authorization(),
        })
      ).statusCode,
    ).toBe(204);
    const outbox = await sql<
      { object_key: string }[]
    >`select object_key from trail.object_deletion_outbox where source_photo_id=${photoId} order by object_key`;
    expect(outbox.map((row) => row.object_key)).toEqual(
      [stagingObjectKey, normalizedObjectKey].sort(),
    );
  });
  it('limits owner canonicalization to two concurrent creates', async () => {
    const requests = Array.from({ length: 3 }, () => {
      const input = payload(randomUUID());
      input.points = Array.from({ length: 5_000 }, (_, index) => ({
        sequence: index,
        latitude: 0,
        longitude: index / 100_000_000,
        elevation_m: null,
        accuracy_m: null,
        recorded_at: new Date(
          Date.parse(input.started_at) + index,
        ).toISOString(),
      }));
      return create(input);
    });
    const statuses = (await Promise.all(requests))
      .map((response) => response.statusCode)
      .sort();
    expect(statuses).toEqual([201, 201, 429]);
  });
});
