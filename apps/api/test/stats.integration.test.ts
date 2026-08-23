import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type {
  CalendarDayResponse,
  CalendarResponse,
  StatsResponse,
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

suite('Phase 7 stats and calendar API', () => {
  const databaseName = `trail_stats_test_${process.pid}_${Date.now()}`;
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof buildApp>;
  let ownerToken: string;
  let otherToken: string;
  const auth = (token = ownerToken) => ({ authorization: `Bearer ${token}` });
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
        presignPost: async () => ({ url: 'https://example.test', fields: {} }),
        presignGet: async () => 'https://example.test',
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
    app = buildApp({ config: testConfig, providers, logger: false });
    await app.ready();
    ownerToken = (await signAccessToken(owner, 0, testConfig)).token;
    otherToken = (await signAccessToken(other, 0, testConfig)).token;
  });
  beforeEach(async () => {
    await sql`truncate trail.users cascade`;
    await sql`insert into trail.users (id,display_name) values (${owner},'Owner'),(${other},'Other')`;
  });
  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`DROP DATABASE "${databaseName}"`);
    await admin.end();
  });
  async function activity(
    id: number,
    user: string,
    sport: string,
    startedAt: string,
    distance = 1000,
    moving = 600,
    elevation = 10,
  ) {
    const uuid = `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
    const endedAt = new Date(
      Date.parse(startedAt) + moving * 1000,
    ).toISOString();
    await sql`insert into trail.activities (id,user_id,sport,started_at,ended_at,distance_m,moving_time_s,elapsed_time_s,elevation_gain_m,elevation_loss_m,polyline,polylines,ingest_hash) values (${uuid},${user},${sport},${startedAt},${endedAt},${distance},${moving},${moving},${elevation},0,'?',${'["?"]'},${'a'.repeat(64)})`;
    return uuid;
  }
  const statsUrl = (sport = 'all') =>
    `/v1/stats?period=week&sport=${sport}&timezone=America%2FNew_York&starts_at=2026-03-08T05%3A00%3A00.000Z&ends_at=2026-03-15T04%3A00%3A00.000Z`;

  it('aggregates canonical rows across DST with sport and owner isolation', async () => {
    await activity(1, owner, 'run', '2026-03-08T05:00:00.000Z', 1000, 600, 20);
    await activity(2, owner, 'ride', '2026-03-15T03:59:59.000Z', 2000, 900, 30);
    await activity(
      3,
      owner,
      'walk',
      '2026-03-15T04:00:00.000Z',
      4000,
      1000,
      40,
    );
    await activity(4, other, 'run', '2026-03-10T12:00:00.000Z', 8000, 1000, 50);
    const all = await app.inject({
      method: 'GET',
      url: statsUrl(),
      headers: auth(),
    });
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json<StatsResponse>().totals).toEqual({
      distance_m: 3000,
      moving_time_s: 1500,
      activity_count: 2,
      elevation_gain_m: 50,
    });
    const run = await app.inject({
      method: 'GET',
      url: statsUrl('run'),
      headers: auth(),
    });
    expect(run.json<StatsResponse>().totals.activity_count).toBe(1);
  });

  it('uses a 169-hour local week across fall-back DST', async () => {
    await activity(5, owner, 'run', '2026-11-01T04:00:00.000Z');
    await activity(6, owner, 'ride', '2026-11-08T04:59:59.000Z');
    const result = await app.inject({
      method: 'GET',
      url: '/v1/stats?period=week&sport=all&timezone=America%2FNew_York&starts_at=2026-11-01T04%3A00%3A00.000Z&ends_at=2026-11-08T05%3A00%3A00.000Z',
      headers: auth(),
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json<StatsResponse>().totals.activity_count).toBe(2);
  });

  it('rejects unauthenticated, invalid timezone, and arbitrary expensive ranges', async () => {
    expect(
      (await app.inject({ method: 'GET', url: statsUrl() })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: statsUrl().replace('America%2FNew_York', '%2B02%3A00'),
          headers: auth(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: statsUrl().replace(
            '2026-03-15T04%3A00%3A00.000Z',
            '2026-04-15T04%3A00%3A00.000Z',
          ),
          headers: auth(),
        })
      ).statusCode,
    ).toBe(400);
  });

  it('uses exact local calendar-year boundaries when UTC dates differ', async () => {
    await activity(7, owner, 'run', '2026-01-01T04:59:59.000Z');
    await activity(8, owner, 'ride', '2026-01-01T05:00:00.000Z');
    await activity(9, owner, 'walk', '2027-01-01T04:59:59.000Z');
    const result = await app.inject({
      method: 'GET',
      url: '/v1/stats?period=year&sport=all&timezone=America%2FNew_York&starts_at=2026-01-01T05%3A00%3A00.000Z&ends_at=2027-01-01T05%3A00%3A00.000Z',
      headers: auth(),
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json<StatsResponse>().totals.activity_count).toBe(2);
  });

  it('groups local month/day across UTC year boundaries and returns selected-day summaries', async () => {
    await activity(10, owner, 'hike', '2026-01-01T04:30:00.000Z'); // Dec 31 local
    await activity(11, owner, 'run', '2026-01-01T05:30:00.000Z'); // Jan 1 local
    const december = await app.inject({
      method: 'GET',
      url: '/v1/calendar?year=2025&month=12&timezone=America%2FNew_York&sport=all',
      headers: auth(),
    });
    expect(december.statusCode, december.body).toBe(200);
    expect(december.json<CalendarResponse>().days).toEqual([
      { date: '2025-12-31', activity_count: 1 },
    ]);
    const day = await app.inject({
      method: 'GET',
      url: '/v1/calendar/day?date=2026-01-01&timezone=America%2FNew_York&sport=all',
      headers: auth(),
    });
    expect(
      day.json<CalendarDayResponse>().items.map((item) => item.id),
    ).toEqual(['00000000-0000-4000-8000-000000000011']);
  });

  it('isolates every stats and calendar read to the authenticated owner', async () => {
    await activity(12, owner, 'run', '2026-03-10T12:00:00.000Z');
    const urls = [
      statsUrl(),
      '/v1/calendar?year=2026&month=3&timezone=America%2FNew_York&sport=all',
      '/v1/calendar/day?date=2026-03-10&timezone=America%2FNew_York&sport=all',
    ];
    for (const url of urls) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: auth(otherToken),
      });
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).not.toContain(
        '00000000-0000-4000-8000-000000000012',
      );
      if (url.startsWith('/v1/stats')) {
        expect(response.json<StatsResponse>().totals.activity_count).toBe(0);
      } else if (url.startsWith('/v1/calendar/day')) {
        expect(response.json<CalendarDayResponse>().items).toEqual([]);
      } else {
        expect(response.json<CalendarResponse>().days).toEqual([]);
      }
    }
  });

  it('reflects late inserts and deletion without stale rollups', async () => {
    const first = await activity(20, owner, 'run', '2026-03-10T12:00:00.000Z');
    expect(
      (
        await app.inject({ method: 'GET', url: statsUrl(), headers: auth() })
      ).json<StatsResponse>().totals.activity_count,
    ).toBe(1);
    await activity(21, owner, 'run', '2026-03-11T12:00:00.000Z');
    await sql`delete from trail.activities where id=${first}`;
    const result = await app.inject({
      method: 'GET',
      url: statsUrl(),
      headers: auth(),
    });
    expect(result.json<StatsResponse>().totals.activity_count).toBe(1);
  });

  it('has owner/time and owner/sport/time indexes usable by bounded queries', async () => {
    await activity(30, owner, 'run', '2026-03-10T12:00:00.000Z');
    await sql`set enable_seqscan=off`;
    const allPlan =
      await sql`explain (format json) select * from trail.activities where user_id=${owner} and started_at >= ${'2026-03-08T05:00:00.000Z'} and started_at < ${'2026-03-15T04:00:00.000Z'}`;
    const sportPlan =
      await sql`explain (format json) select * from trail.activities where user_id=${owner} and sport='run' and started_at >= ${'2026-03-08T05:00:00.000Z'} and started_at < ${'2026-03-15T04:00:00.000Z'}`;
    expect(JSON.stringify(allPlan)).toMatch(
      /activities_user_(?:sport_)?started_at_idx/,
    );
    expect(JSON.stringify(sportPlan)).toContain(
      'activities_user_sport_started_at_idx',
    );
    await sql`reset enable_seqscan`;
  });
});
