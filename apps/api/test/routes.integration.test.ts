import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type {
  CreateActivityRequest,
  ErrorEnvelope,
  Route,
  RouteListResponse,
} from '@trail/contracts';
import { encodePolyline, trackDistanceM } from '@trail/domain';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { buildApp } from '../src/app.js';
import { signAccessToken } from '../src/auth/crypto.js';
import type { DependencyStatus, Providers } from '../src/providers/ports.js';
import { testConfig } from './fixtures.js';

const baseDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = baseDatabaseUrl ? describe : describe.skip;
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const points = [
  { latitude: 0, longitude: 0 },
  { latitude: 0, longitude: 0.001 },
  { latitude: 0.001, longitude: 0.001 },
  { latitude: 0.001, longitude: 0.002 },
  { latitude: 0.002, longitude: 0.002 },
];
suite('Phase 6 route API', () => {
  const databaseName = `trail_route_test_${process.pid}_${Date.now()}`;
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof buildApp>;
  let ownerToken: string;
  let otherToken: string;
  const routing = vi.fn();
  const elevation = vi.fn();
  const auth = (token = ownerToken) => ({ authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const url = new URL(baseDatabaseUrl!);
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    sql = postgres(url.toString());
    await migrate(drizzle(sql), {
      migrationsFolder: fileURLToPath(
        new URL('../src/db/migrations', import.meta.url),
      ),
    });
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
        presignPost: async () => ({ url: '', fields: {} }),
        presignGet: async () => '',
        head: async () => null,
        get: async () => Readable.from([]),
        put: async () => undefined,
        delete: async () => undefined,
      },
      email: { enabled: false, checkHealth, send: async () => undefined },
      mapStyle: { styleUrl: 'https://example.test' },
      elevation: { getElevations: elevation },
      routing: { route: routing },
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
    await sql`insert into trail.users (id,email,display_name,units) values (${owner},'owner@example.test','Owner','metric'),(${other},'other@example.test','Other','metric')`;
  });
  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`DROP DATABASE "${databaseName}"`);
    await admin.end();
  });
  it('authenticates CRUD, scopes ownership, paginates, recomputes five raw points, and clears activity relation on delete', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/v1/routes' })).statusCode,
    ).toBe(401);
    const ids = [
      '00000000-0000-4000-8000-000000000601',
      '00000000-0000-4000-8000-000000000602',
    ];
    for (const id of ids) {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/routes',
        headers: auth(),
        payload: {
          id,
          name: `Route ${id.at(-1)}`,
          sport_hint: 'run',
          waypoints: points,
          distance_m: 1,
          polyline: 'client',
        },
      });
      expect(created.statusCode, created.body).toBe(201);
    }
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/routes',
      headers: auth(),
      payload: {
        id: ids[0],
        name: 'Route 1',
        sport_hint: 'run',
        waypoints: points,
      },
    });
    expect(replay.statusCode).toBe(200);
    const conflicting = await app.inject({
      method: 'POST',
      url: '/v1/routes',
      headers: auth(),
      payload: {
        id: ids[0],
        name: 'Changed replay',
        sport_hint: 'run',
        waypoints: points,
      },
    });
    const crossOwnerDuplicate = await app.inject({
      method: 'POST',
      url: '/v1/routes',
      headers: auth(otherToken),
      payload: {
        id: ids[0],
        name: 'Route 1',
        sport_hint: 'run',
        waypoints: points,
      },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(crossOwnerDuplicate.statusCode).toBe(409);
    expect(conflicting.json<ErrorEnvelope>().error).toEqual(
      crossOwnerDuplicate.json<ErrorEnvelope>().error,
    );
    const detail = (
      await app.inject({
        method: 'GET',
        url: `/v1/routes/${ids[0]}`,
        headers: auth(),
      })
    ).json<Route>();
    expect(detail.distance_m).toBeCloseTo(trackDistanceM(points), 6);
    expect(detail.polyline).toBe(encodePolyline(points));
    expect(detail.elevation_gain_m).toBeNull();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/routes/${ids[0]}`,
          headers: auth(otherToken),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/routes/${ids[0]}`,
          headers: auth(otherToken),
          payload: { name: 'Other owner edit' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/routes/${ids[0]}`,
          headers: auth(otherToken),
        })
      ).statusCode,
    ).toBe(404);
    const firstPage = (
      await app.inject({
        method: 'GET',
        url: '/v1/routes?limit=1',
        headers: auth(),
      })
    ).json<RouteListResponse>();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.page.has_more).toBe(true);
    const secondPage = (
      await app.inject({
        method: 'GET',
        url: `/v1/routes?limit=1&cursor=${encodeURIComponent(firstPage.page.next_cursor!)}`,
        headers: auth(),
      })
    ).json<RouteListResponse>();
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
    for (const malformed of [
      { createdAt: '2026-01-01T00:00:00.000Z', id: 'not-a-uuid' },
      { createdAt: 'not-a-date', id: ids[0] },
      { createdAt: '2026-01-01T00:00:00.000Z', id: ids[0], extra: true },
    ]) {
      const cursor = Buffer.from(JSON.stringify(malformed)).toString(
        'base64url',
      );
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/routes?cursor=${cursor}`,
            headers: auth(),
          })
        ).statusCode,
      ).toBe(400);
    }
    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/routes/${ids[0]}`,
      headers: auth(),
      payload: { name: 'Updated', waypoints: points.slice(0, 2) },
    });
    expect(patch.json<Route>().name).toBe('Updated');
    expect(patch.json<Route>().distance_m).toBeCloseTo(
      trackDistanceM(points.slice(0, 2)),
      6,
    );
    const activity: CreateActivityRequest = {
      payload_version: 1,
      id: '00000000-0000-4000-8000-000000000699',
      sport: 'run',
      title: null,
      notes: null,
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:30.000Z',
      route_id: ids[0],
      pauses: [],
      points: [
        {
          sequence: 0,
          latitude: 0,
          longitude: 0,
          elevation_m: null,
          accuracy_m: 3,
          recorded_at: '2026-01-01T00:00:00.000Z',
        },
        {
          sequence: 1,
          latitude: 0,
          longitude: 0.001,
          elevation_m: null,
          accuracy_m: 3,
          recorded_at: '2026-01-01T00:00:30.000Z',
        },
      ],
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/activities',
          headers: auth(otherToken),
          payload: activity,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/activities',
          headers: auth(),
          payload: activity,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/routes/${ids[0]}`,
          headers: auth(),
        })
      ).statusCode,
    ).toBe(204);
    const rows = await sql<
      { route_id: string | null }[]
    >`select route_id from trail.activities where id=${activity.id}`;
    expect(rows[0]?.route_id).toBeNull();
    expect(routing).not.toHaveBeenCalled();
    expect(elevation).not.toHaveBeenCalled();
  });
});
