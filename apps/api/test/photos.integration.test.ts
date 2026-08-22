import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { signAccessToken } from '../src/auth/crypto.js';
import type {
  DependencyStatus,
  ObjectStorageProvider,
  Providers,
} from '../src/providers/ports.js';
import {
  drainObjectDeletionOutbox,
  drainPhotoProcessing,
} from '../src/photos/workers.js';
import { testConfig } from './fixtures.js';

const baseDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI === 'true' && !baseDatabaseUrl)
  throw new Error('TEST_DATABASE_URL is required for database tests in CI');
const suite = baseDatabaseUrl ? describe : describe.skip;
const migrationsFolder = fileURLToPath(
  new URL('../src/db/migrations', import.meta.url),
);
const owner = '00000000-0000-4000-8000-000000000011';
const other = '00000000-0000-4000-8000-000000000012';
const activity = '00000000-0000-4000-8000-000000000101';

class MemoryStorage implements ObjectStorageProvider {
  readonly bucket = 'private';
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  readonly deleted: string[] = [];
  failPresign = false;
  failDelete = false;
  readonly failDeleteKeys = new Set<string>();
  async checkHealth(): Promise<DependencyStatus> {
    return 'up';
  }
  async presignPost(
    key: string,
    contentType: string,
    minimumBytes: number,
    maximumBytes: number,
    expiresSeconds: number,
  ) {
    if (this.failPresign) throw new Error('presign unavailable');
    return {
      url: `https://upload.example.test?expires=${expiresSeconds}`,
      fields: {
        key,
        'Content-Type': contentType,
        minimumBytes: String(minimumBytes),
        maximumBytes: String(maximumBytes),
      },
    };
  }
  async presignGet(key: string, expiresSeconds: number) {
    return `https://download.example.test/${encodeURIComponent(key)}?expires=${expiresSeconds}`;
  }
  async head(key: string) {
    const value = this.objects.get(key);
    return value
      ? { sizeBytes: value.body.length, contentType: value.contentType }
      : null;
  }
  async get(key: string) {
    const value = this.objects.get(key);
    if (!value) throw new Error('NoSuchKey');
    return Readable.from(value.body);
  }
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async delete(key: string) {
    if (this.failDelete || this.failDeleteKeys.has(key))
      throw new Error('delete unavailable');
    this.objects.delete(key);
    this.deleted.push(key);
  }
}

suite('Phase 5 private photo API', () => {
  const databaseName = `trail_photo_test_${process.pid}_${Date.now()}`;
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof buildApp>;
  let providers: Providers;
  let storage: MemoryStorage;
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
    storage = new MemoryStorage();
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
    ownerToken = (await signAccessToken(owner, 0, testConfig)).token;
    otherToken = (await signAccessToken(other, 0, testConfig)).token;
  });

  beforeEach(async () => {
    storage.objects.clear();
    storage.deleted.length = 0;
    storage.failPresign = false;
    storage.failDelete = false;
    storage.failDeleteKeys.clear();
    await sql`truncate trail.users cascade`;
    await sql`delete from trail.object_deletion_outbox`;
    await sql`insert into trail.users (id,email,display_name) values (${owner},'photo-owner@example.test','Owner'),(${other},'photo-other@example.test','Other')`;
    await sql`insert into trail.activities (id,user_id,sport,started_at,ended_at,distance_m,moving_time_s,elapsed_time_s,elevation_gain_m,elevation_loss_m,polyline,polylines,ingest_hash) values (${activity},${owner},'run','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z',1,60,60,0,0,'?','["?"]'::jsonb,${'a'.repeat(64)})`;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`DROP DATABASE "${databaseName}"`);
    await admin.end();
  });

  async function initiate(
    size: number,
    token = ownerToken,
    mime: 'image/jpeg' | 'image/webp' | 'image/heic' = 'image/jpeg',
  ) {
    return app.inject({
      method: 'POST',
      url: `/v1/activities/${activity}/photos/initiate`,
      headers: auth(token),
      payload: { input_mime: mime, input_size_bytes: size },
    });
  }

  it('enforces authentication, ownership, exact limits, and 15-minute upload expiry', async () => {
    expect((await initiate(1, otherToken)).statusCode).toBe(404);
    expect((await initiate(10 * 1024 * 1024 + 1)).statusCode).toBe(400);
    const responses = await Promise.all(
      Array.from({ length: 11 }, () => initiate(1)),
    );
    expect(
      responses.filter((response) => response.statusCode === 201),
    ).toHaveLength(10);
    expect(
      responses.filter((response) => response.statusCode === 409),
    ).toHaveLength(1);
    const first = responses
      .find((response) => response.statusCode === 201)!
      .json<{
        upload_url: string;
        expires_at: string;
        form_fields: Record<string, string>;
      }>();
    expect(first.upload_url).toContain('expires=900');
    expect(first.form_fields).toMatchObject({
      minimumBytes: '1',
      maximumBytes: '1',
    });
    expect(Date.parse(first.expires_at) - Date.now()).toBeGreaterThan(890_000);
  });

  it('returns stable staging_missing when direct upload did not commit', async () => {
    const initiated = (await initiate(10)).json<{ photo_id: string }>();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}/complete`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'staging_missing' },
    });
  });

  it('reissues the same owner-scoped reservation without consuming a slot', async () => {
    const initiated = (await initiate(10)).json<{ photo_id: string }>();
    const reissued = await app.inject({
      method: 'POST',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}/reissue`,
      headers: auth(),
    });
    expect(reissued.statusCode, reissued.body).toBe(200);
    expect(reissued.json()).toMatchObject({
      photo_id: initiated.photo_id,
      status: 'pending',
      form_fields: { minimumBytes: '10', maximumBytes: '10' },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/activities/${activity}/photos/${initiated.photo_id}/reissue`,
          headers: auth(otherToken),
        })
      ).statusCode,
    ).toBe(404);
    const counts = await sql<
      { photos: number; attempts: number }[]
    >`select count(*)::int as photos,max(upload_attempt_count)::int as attempts from trail.activity_photos where activity_id=${activity}`;
    expect(counts[0]).toEqual({ photos: 1, attempts: 2 });
    await sql`update trail.activity_photos set upload_attempt_count=5 where id=${initiated.photo_id}`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/activities/${activity}/photos/${initiated.photo_id}/reissue`,
          headers: auth(),
        })
      ).statusCode,
    ).toBe(409);
    await app.inject({
      method: 'DELETE',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}`,
      headers: auth(),
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/activities/${activity}/photos/${initiated.photo_id}/reissue`,
          headers: auth(),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('preserves the latest reissue expiry through processing and replay cleanup', async () => {
    const input = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: '#445566',
      },
    })
      .jpeg()
      .toBuffer();
    const initiated = (await initiate(input.length)).json<{
      photo_id: string;
    }>();
    const stagingKey = `users/${owner}/activities/${activity}/photos/${initiated.photo_id}/staging`;
    await sql`update trail.activity_photos set created_at=now()-interval '1 day' where id=${initiated.photo_id}`;
    await sql`insert into trail.object_deletion_outbox (owner_user_id,source_activity_id,source_photo_id,object_key,status,attempt_count,next_attempt_at,completed_at) values (${owner},${activity},${initiated.photo_id},${stagingKey},'completed',1,now()-interval '1 hour',now()-interval '1 hour')`;
    const reissued = await app.inject({
      method: 'POST',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}/reissue`,
      headers: auth(),
    });
    expect(reissued.statusCode, reissued.body).toBe(200);
    storage.objects.set(stagingKey, {
      body: input,
      contentType: 'image/jpeg',
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/activities/${activity}/photos/${initiated.photo_id}/complete`,
          headers: auth(),
        })
      ).statusCode,
    ).toBe(202);
    expect(await drainPhotoProcessing(providers)).toBe(1);
    const deadline = await sql<
      { protected: boolean; status: string }[]
    >`select next_attempt_at>now()+interval '14 minutes' as protected,status from trail.object_deletion_outbox where object_key=${stagingKey}`;
    expect(deadline[0]).toEqual({ protected: true, status: 'pending' });
    storage.objects.set(stagingKey, {
      body: Buffer.from('replayed-before-expiry'),
      contentType: 'image/jpeg',
    });
    expect(await drainObjectDeletionOutbox(providers)).toBe(0);
    expect(storage.objects.has(stagingKey)).toBe(true);
    await sql`update trail.object_deletion_outbox set next_attempt_at=now() where object_key=${stagingKey}`;
    expect(await drainObjectDeletionOutbox(providers)).toBe(1);
    expect(storage.objects.has(stagingKey)).toBe(false);
  });

  it('verifies object bytes, processes asynchronously, strips metadata, and is completion-idempotent', async () => {
    const input = await sharp({
      create: {
        width: 5000,
        height: 100,
        channels: 3,
        background: '#123456',
      },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Artist: 'sensitive' } } })
      .toBuffer();
    const initiated = (await initiate(input.length)).json<{
      photo_id: string;
    }>();
    const key = `users/${owner}/activities/${activity}/photos/${initiated.photo_id}/staging`;
    storage.objects.set(key, { body: input, contentType: 'image/jpeg' });
    const first = await app.inject({
      method: 'POST',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}/complete`,
      headers: auth(),
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}/complete`,
      headers: auth(),
    });
    expect(first.statusCode).toBe(202);
    expect(replay.json()).toEqual(first.json());
    expect(await drainPhotoProcessing(providers, 2)).toBe(1);
    const state =
      await sql`select status,error_code,processing_attempt_count from trail.activity_photos where id=${initiated.photo_id}`;
    expect(state).toEqual([
      { status: 'ready', error_code: null, processing_attempt_count: 1 },
    ]);
    const list = await app.inject({
      method: 'GET',
      url: `/v1/activities/${activity}/photos`,
      headers: auth(),
    });
    const photo =
      list.json<
        Array<{ status: string; width: number; download_url: string }>
      >()[0]!;
    expect(photo.status).toBe('ready');
    expect(photo.width).toBe(4096);
    expect(photo.download_url).toContain('expires=900');
    const normalizedKey = `users/${owner}/activities/${activity}/photos/${initiated.photo_id}/normalized`;
    expect(storage.objects.has(key)).toBe(false);
    const metadata = await sharp(
      storage.objects.get(normalizedKey)!.body,
    ).metadata();
    expect(metadata.exif).toBeUndefined();
    const readyHash = createHash('sha256')
      .update(storage.objects.get(normalizedKey)!.body)
      .digest('hex');
    storage.objects.set(key, {
      body: Buffer.from('replayed staging capability'),
      contentType: 'image/jpeg',
    });
    const readyReplay = await app.inject({
      method: 'POST',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}/complete`,
      headers: auth(),
    });
    expect(readyReplay.json()).toMatchObject({ status: 'ready' });
    expect(storage.objects.has(key)).toBe(false);
    expect(
      createHash('sha256')
        .update(storage.objects.get(normalizedKey)!.body)
        .digest('hex'),
    ).toBe(readyHash);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/activities/${activity}/photos/${initiated.photo_id}/download`,
          headers: auth(otherToken),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('normalizes WebP through the real storage worker path', async () => {
    const input = await sharp({
      create: {
        width: 32,
        height: 16,
        channels: 3,
        background: '#abcdef',
      },
    })
      .webp()
      .toBuffer();
    const initiated = (
      await initiate(input.length, ownerToken, 'image/webp')
    ).json<{
      photo_id: string;
    }>();
    const stagingKey = `users/${owner}/activities/${activity}/photos/${initiated.photo_id}/staging`;
    const normalizedKey = `users/${owner}/activities/${activity}/photos/${initiated.photo_id}/normalized`;
    storage.objects.set(stagingKey, { body: input, contentType: 'image/webp' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/activities/${activity}/photos/${initiated.photo_id}/complete`,
          headers: auth(),
        })
      ).statusCode,
    ).toBe(202);
    expect(await drainPhotoProcessing(providers)).toBe(1);
    expect(storage.objects.get(normalizedKey)?.contentType).toBe('image/webp');
    expect(
      (await sharp(storage.objects.get(normalizedKey)!.body).metadata()).format,
    ).toBe('webp');
  });

  it('rejects HEAD MIME mismatch before processing and deletes staging', async () => {
    const body = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#ffffff',
      },
    })
      .jpeg()
      .toBuffer();
    const initiated = (await initiate(body.length)).json<{
      photo_id: string;
    }>();
    const key = `users/${owner}/activities/${activity}/photos/${initiated.photo_id}/staging`;
    storage.objects.set(key, { body, contentType: 'text/plain' });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}/complete`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(415);
    expect(storage.objects.has(key)).toBe(false);
  });

  it('rejects malformed/polyglot bytes and handles size mismatch without processing', async () => {
    const body = Buffer.from('not a supported image');
    const initiated = (await initiate(body.length)).json<{
      photo_id: string;
    }>();
    const key = `users/${owner}/activities/${activity}/photos/${initiated.photo_id}/staging`;
    storage.objects.set(key, { body, contentType: 'image/jpeg' });
    await app.inject({
      method: 'POST',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}/complete`,
      headers: auth(),
    });
    await drainPhotoProcessing(providers);
    const rows = await sql<
      { status: string; error_code: string }[]
    >`select status,error_code from trail.activity_photos where id=${initiated.photo_id}`;
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error_code: 'unsupported_media_type',
    });

    const mismatch = (await initiate(5)).json<{ photo_id: string }>();
    const mismatchKey = `users/${owner}/activities/${activity}/photos/${mismatch.photo_id}/staging`;
    storage.objects.set(mismatchKey, {
      body: Buffer.alloc(6),
      contentType: 'image/jpeg',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/activities/${activity}/photos/${mismatch.photo_id}/complete`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(409);
  });

  it('queues idempotent object deletion for photo and activity deletes and purges objects', async () => {
    const initiated = (await initiate(1)).json<{ photo_id: string }>();
    const key = `users/${owner}/activities/${activity}/photos/${initiated.photo_id}/staging`;
    storage.objects.set(key, {
      body: Buffer.alloc(1),
      contentType: 'image/jpeg',
    });
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}`,
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/activities/${activity}/photos/${initiated.photo_id}`,
          headers: auth(),
        })
      ).statusCode,
    ).toBe(204);
    const delayed = await sql<
      { protected: boolean }[]
    >`select next_attempt_at > now() as protected from trail.object_deletion_outbox where source_photo_id=${initiated.photo_id}`;
    expect(delayed[0]?.protected).toBe(true);
    expect(await drainObjectDeletionOutbox(providers)).toBe(1);
    await sql`update trail.object_deletion_outbox set next_attempt_at=now() where source_photo_id=${initiated.photo_id}`;
    expect(await drainObjectDeletionOutbox(providers)).toBe(1);
    expect(storage.objects.has(key)).toBe(false);

    const second = (await initiate(1)).json<{ photo_id: string }>();
    const secondKey = `users/${owner}/activities/${activity}/photos/${second.photo_id}/staging`;
    storage.objects.set(secondKey, {
      body: Buffer.alloc(1),
      contentType: 'image/jpeg',
    });
    await sql`delete from trail.activities where id=${activity} and user_id=${owner}`;
    const jobs = await sql<
      { count: number }[]
    >`select count(*)::int as count from trail.object_deletion_outbox where source_photo_id=${second.photo_id}`;
    expect(jobs[0]?.count).toBe(2);
    await sql`update trail.object_deletion_outbox set next_attempt_at=now() where source_photo_id=${second.photo_id}`;
    expect(await drainObjectDeletionOutbox(providers)).toBe(2);
    expect(storage.objects.has(secondKey)).toBe(false);
  });

  it('retries deletion safely and cleans failed initiation reservations without orphans', async () => {
    storage.failPresign = true;
    expect((await initiate(1)).statusCode).toBe(500);
    const photos = await sql<
      { count: number }[]
    >`select count(*)::int as count from trail.activity_photos`;
    expect(photos[0]?.count).toBe(0);
    storage.failPresign = false;
    await drainObjectDeletionOutbox(providers);

    const initiated = (await initiate(1)).json<{ photo_id: string }>();
    const key = `users/${owner}/activities/${activity}/photos/${initiated.photo_id}/staging`;
    storage.objects.set(key, {
      body: Buffer.alloc(1),
      contentType: 'image/jpeg',
    });
    await app.inject({
      method: 'DELETE',
      url: `/v1/activities/${activity}/photos/${initiated.photo_id}`,
      headers: auth(),
    });
    expect(await drainObjectDeletionOutbox(providers, 1)).toBe(1);
    await sql`update trail.object_deletion_outbox set next_attempt_at=now() where object_key=${key}`;
    storage.failDelete = true;
    expect(await drainObjectDeletionOutbox(providers, 1)).toBe(1);
    const retry = await sql<
      { status: string; attempt_count: number }[]
    >`select status,attempt_count from trail.object_deletion_outbox where object_key=${key}`;
    expect(retry[0]).toMatchObject({ status: 'retry', attempt_count: 1 });
    storage.failDelete = false;
    await sql`update trail.object_deletion_outbox set next_attempt_at=now() where object_key=${key}`;
    expect(await drainObjectDeletionOutbox(providers, 1)).toBe(1);
    expect(storage.objects.has(key)).toBe(false);
  });

  it('isolates poison deletion jobs and clamps terminal attempts', async () => {
    const failedPhoto = '00000000-0000-4000-8000-000000000701';
    const goodPhoto = '00000000-0000-4000-8000-000000000702';
    const failedKey = `users/${owner}/activities/${activity}/photos/${failedPhoto}/staging`;
    const goodKey = `users/${owner}/activities/${activity}/photos/${goodPhoto}/normalized`;
    storage.objects.set(failedKey, {
      body: Buffer.from('failed'),
      contentType: 'image/jpeg',
    });
    storage.objects.set(goodKey, {
      body: Buffer.from('good'),
      contentType: 'image/jpeg',
    });
    storage.failDeleteKeys.add(failedKey);
    await sql`insert into trail.object_deletion_outbox (id,owner_user_id,source_activity_id,source_photo_id,object_key,status,attempt_count,next_attempt_at) values ('00000000-0000-4000-8000-000000000801',${owner},${activity},${failedPhoto},${failedKey},'retry',9,now()),('00000000-0000-4000-8000-000000000802',${owner},${activity},${goodPhoto},${goodKey},'pending',0,now())`;

    expect(await drainObjectDeletionOutbox(providers, 2)).toBe(2);

    const jobs = await sql<
      { object_key: string; status: string; attempt_count: number }[]
    >`select object_key,status,attempt_count from trail.object_deletion_outbox order by object_key`;
    expect(jobs).toEqual(
      expect.arrayContaining([
        {
          object_key: failedKey,
          status: 'failed',
          attempt_count: 10,
        },
        { object_key: goodKey, status: 'completed', attempt_count: 1 },
      ]),
    );
    expect(storage.objects.has(goodKey)).toBe(false);
    expect(storage.objects.has(failedKey)).toBe(true);
  });
});
