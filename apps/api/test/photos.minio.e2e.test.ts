import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { signAccessToken } from '../src/auth/crypto.js';
import {
  drainObjectDeletionOutbox,
  drainPhotoProcessing,
} from '../src/photos/workers.js';
import type { DependencyStatus, Providers } from '../src/providers/ports.js';
import { createS3CompatibleObjectStorage } from '../src/providers/s3-compatible.js';
import { testConfig } from './fixtures.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.TEST_MINIO === 'true' && Boolean(databaseUrl);
const suite = enabled ? describe : describe.skip;
const migrationsFolder = fileURLToPath(
  new URL('../src/db/migrations', import.meta.url),
);
const owner = '00000000-0000-4000-8000-000000000021';
const activity = '00000000-0000-4000-8000-000000000121';

suite('three-photo PostgreSQL and MinIO lifecycle', () => {
  const databaseName = `trail_photo_minio_${process.pid}_${Date.now()}`;
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof buildApp>;
  let providers: Providers;
  let token: string;
  const storage = createS3CompatibleObjectStorage({
    endpoint: '127.0.0.1',
    port: 9000,
    useSsl: false,
    accessKey: 'trail-app',
    secretKey: 'trail-app-local-value',
    bucket: 'trail-private',
  });

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    sql = postgres(url.toString(), { max: 8, onnotice: () => undefined });
    await migrate(drizzle(sql), { migrationsFolder });
    await sql`insert into trail.users (id,email,display_name) values (${owner},'minio-photo@example.test','MinIO Owner')`;
    await sql`insert into trail.activities (id,user_id,sport,started_at,ended_at,distance_m,moving_time_s,elapsed_time_s,elevation_gain_m,elevation_loss_m,polyline,polylines,ingest_hash) values (${activity},${owner},'run','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z',1,60,60,0,0,'?','["?"]'::jsonb,${'b'.repeat(64)})`;
    const checkHealth = async (): Promise<DependencyStatus> => 'up';
    const disabled = {
      enabled: false,
      verify: async () => Promise.reject(new Error('disabled')),
    };
    providers = {
      database: { sql, checkHealth },
      identity: { apple: disabled, google: disabled },
      objectStorage: storage,
      email: { enabled: false, checkHealth, send: async () => undefined },
      mapStyle: { styleUrl: 'https://example.test/style.json' },
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
    token = (await signAccessToken(owner, 0, testConfig)).token;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`DROP DATABASE "${databaseName}"`);
    await admin.end();
  });

  it('uploads three, retries one provider rejection, normalizes, and deletes every blob for one photo', async () => {
    const bodies = await Promise.all(
      ['#aa0000', '#00aa00', '#0000aa'].map((background) =>
        sharp({ create: { width: 24, height: 16, channels: 3, background } })
          .jpeg()
          .toBuffer(),
      ),
    );
    const initiated: Array<{
      photo_id: string;
      upload_url: string;
      form_fields: Record<string, string>;
    }> = [];
    for (const body of bodies) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/activities/${activity}/photos/initiate`,
        headers: { authorization: `Bearer ${token}` },
        payload: { input_mime: 'image/jpeg', input_size_bytes: body.length },
      });
      expect(response.statusCode, response.body).toBe(201);
      initiated.push(response.json());
    }
    const upload = async (
      signed: (typeof initiated)[number],
      body: Buffer,
      contentType = 'image/jpeg',
    ) => {
      const form = new FormData();
      for (const [name, value] of Object.entries(signed.form_fields))
        form.append(name, name === 'Content-Type' ? contentType : value);
      form.append('file', new Blob([body], { type: contentType }), 'photo');
      return fetch(signed.upload_url, { method: 'POST', body: form });
    };
    expect((await upload(initiated[1]!, bodies[1]!, 'image/webp')).ok).toBe(
      false,
    );
    for (let index = 0; index < initiated.length; index += 1)
      expect((await upload(initiated[index]!, bodies[index]!)).ok).toBe(true);
    for (const photo of initiated) {
      const completed = await app.inject({
        method: 'POST',
        url: `/v1/activities/${activity}/photos/${photo.photo_id}/complete`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(completed.statusCode, completed.body).toBe(202);
    }
    expect(await drainPhotoProcessing(providers, 3)).toBe(3);
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/activities/${activity}/photos`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(
      listed.json<Array<{ status: string }>>().map((photo) => photo.status),
    ).toEqual(['ready', 'ready', 'ready']);
    const deletedId = initiated[1]!.photo_id;
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/activities/${activity}/photos/${deletedId}`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(204);
    await sql`update trail.object_deletion_outbox set next_attempt_at=now() where source_photo_id=${deletedId}`;
    await drainObjectDeletionOutbox(providers, 4);
    const prefix = `users/${owner}/activities/${activity}/photos/${deletedId}`;
    expect(await storage.head(`${prefix}/staging`)).toBeNull();
    expect(await storage.head(`${prefix}/normalized`)).toBeNull();
  });
});
