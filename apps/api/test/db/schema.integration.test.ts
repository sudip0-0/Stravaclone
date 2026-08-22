import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  activities,
  activityElevationSamples,
  activityPhotos,
  activityPoints,
  activitySplits,
  authIdentities,
  objectDeletionOutbox,
  refreshTokenFamilies,
  refreshTokens,
  routes,
  users,
} from '../../src/db/schema.js';
import {
  syntheticActivity,
  syntheticIds,
  syntheticPhotoObjectKey,
  syntheticRoute,
  syntheticUser,
} from './factories.js';

const baseDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI === 'true' && !baseDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for database tests in CI');
}
const describeWithPostgres = baseDatabaseUrl ? describe : describe.skip;
const migrationsFolder = fileURLToPath(
  new URL('../../src/db/migrations', import.meta.url),
);

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { cause?: unknown; code?: unknown };
  if (typeof candidate.code === 'string') return candidate.code;
  return postgresErrorCode(candidate.cause);
}

async function executeMigrationFile(
  client: ReturnType<typeof postgres>,
  filename: string,
): Promise<void> {
  const migration = await readFile(`${migrationsFolder}/${filename}`, 'utf8');
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.unsafe(statement);
  }
}

async function expectPostgresError(
  operation: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    expect(postgresErrorCode(error)).toBe(expectedCode);
    return;
  }
  throw new Error(`Expected PostgreSQL error ${expectedCode}`);
}

describeWithPostgres('Trail PostgreSQL schema', () => {
  const databaseName = `trail_schema_test_${process.pid}_${Date.now()}`;
  let adminClient: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let database: ReturnType<typeof drizzle>;

  const photoValues = (
    id: string = syntheticIds.photo,
    sortOrder = 0,
    userId: string = syntheticIds.owner,
    activityId: string = syntheticIds.activity,
  ) => ({
    id,
    activityId,
    userId,
    objectKey: syntheticPhotoObjectKey(userId, activityId, id),
    sortOrder,
  });

  beforeAll(async () => {
    if (!baseDatabaseUrl) return;
    const adminUrl = new URL(baseDatabaseUrl);
    adminClient = postgres(adminUrl.toString(), {
      max: 1,
      onnotice: () => undefined,
    });
    await adminClient.unsafe(`CREATE DATABASE "${databaseName}"`);

    adminUrl.pathname = `/${databaseName}`;
    client = postgres(adminUrl.toString(), {
      max: 1,
      onnotice: () => undefined,
    });
    database = drizzle(client);
    await migrate(database, { migrationsFolder });
  }, 30_000);

  beforeEach(async () => {
    await client.unsafe(
      'TRUNCATE TABLE trail.object_deletion_outbox, trail.users CASCADE',
    );
  });

  afterAll(async () => {
    if (!baseDatabaseUrl) return;
    if (client) await client.end({ timeout: 5 });
    if (adminClient) {
      await adminClient.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
      );
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await adminClient.end({ timeout: 5 });
    }
  }, 30_000);

  it('upgrades committed Phase 1 data through the single final Phase 2 migration', async () => {
    const upgradeDatabaseName = `trail_phase2_upgrade_${process.pid}_${Date.now()}`;
    await adminClient.unsafe(`CREATE DATABASE "${upgradeDatabaseName}"`);
    const upgradeUrl = new URL(baseDatabaseUrl!);
    upgradeUrl.pathname = `/${upgradeDatabaseName}`;
    const upgradeClient = postgres(upgradeUrl.toString(), {
      max: 1,
      onnotice: () => undefined,
    });
    try {
      await executeMigrationFile(upgradeClient, '0000_foundation.sql');
      await executeMigrationFile(upgradeClient, '0001_phase1_schema.sql');
      const phase1Id = '550e8400-e29b-41d4-a716-446655440099';
      await upgradeClient`
        insert into trail.users (id, email, display_name)
        values (${phase1Id}, 'preserved@example.com', 'Preserved')
      `;
      await executeMigrationFile(upgradeClient, '0002_phase2_auth.sql');
      const preserved = await upgradeClient<
        { email: string; auth_version: number }[]
      >`
        select email, auth_version from trail.users where id = ${phase1Id}
      `;
      expect(preserved).toEqual([
        { email: 'preserved@example.com', auth_version: 0 },
      ]);
      const tables = await upgradeClient<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'trail'
          and table_name in ('registration_verifications', 'email_outbox')
        order by table_name
      `;
      expect(tables.map((row) => row.table_name)).toEqual([
        'email_outbox',
        'registration_verifications',
      ]);
    } finally {
      await upgradeClient.end();
      await adminClient.unsafe(`DROP DATABASE "${upgradeDatabaseName}"`);
    }
  });

  it('applies all forward migrations repeatedly without data loss and exposes client UUID idempotency evidence', async () => {
    await database.insert(users).values(syntheticUser());
    await migrate(database, { migrationsFolder });

    const migrationRows = await client`
      select count(*)::integer as count from drizzle.__drizzle_migrations
    `;
    const activityColumns = await client<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'trail' and table_name = 'activities'
    `;
    const primaryKey = await client`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'trail.activities'::regclass and contype = 'p'
    `;
    expect(migrationRows[0]?.count).toBe(3);
    expect(activityColumns.map((row) => row.column_name)).toContain('id');
    expect(activityColumns.map((row) => row.column_name)).not.toContain(
      'client_id',
    );
    expect(primaryKey[0]?.definition).toBe('PRIMARY KEY (id)');
    expect(
      await client`select count(*)::integer as count from trail.users`,
    ).toMatchObject([{ count: 1 }]);
  });

  it('enforces identity uniqueness, strict hash formats, and auth cascades', async () => {
    await database.insert(users).values(syntheticUser());
    await database.insert(authIdentities).values({
      userId: syntheticIds.owner,
      provider: 'password',
      providerSubject: 'synthetic.owner@example.test',
    });
    await expectPostgresError(
      () =>
        database.insert(users).values(
          syntheticUser({
            id: syntheticIds.otherOwner,
            email: 'SYNTHETIC.OWNER@EXAMPLE.TEST',
          }),
        ),
      '23505',
    );
    await expectPostgresError(
      () =>
        database.insert(users).values(
          syntheticUser({
            id: syntheticIds.otherOwner,
            email: 'other@example.test',
            passwordHash: 'plaintext-is-not-a-password-hash',
          }),
        ),
      '23514',
    );

    const familyId = '00000000-0000-4000-8000-000000000301';
    await database.insert(refreshTokenFamilies).values({
      id: familyId,
      userId: syntheticIds.owner,
      deviceHint: 'synthetic device',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await database.insert(refreshTokens).values({
      familyId,
      sequence: 0,
      tokenHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await expectPostgresError(
      () =>
        database.insert(refreshTokens).values({
          familyId,
          sequence: 1,
          tokenHash: 'A'.repeat(64),
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      '23514',
    );

    const tokenColumns = await client<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'trail' and table_name = 'refresh_tokens'
    `;
    expect(tokenColumns.map((row) => row.column_name)).toContain('token_hash');
    expect(tokenColumns.map((row) => row.column_name)).not.toContain('token');

    await database.delete(users).where(eq(users.id, syntheticIds.owner));
    const counts = await client`
      select
        (select count(*)::integer from trail.auth_identities) as identities,
        (select count(*)::integer from trail.refresh_token_families) as families,
        (select count(*)::integer from trail.refresh_tokens) as tokens
    `;
    expect(counts[0]).toMatchObject({ identities: 0, families: 0, tokens: 0 });
  });

  it('keeps route owner validation and nulls only route_id when a referenced route is deleted', async () => {
    await database.insert(users).values([
      syntheticUser(),
      syntheticUser({
        id: syntheticIds.otherOwner,
        email: 'other.synthetic@example.test',
      }),
    ]);
    await database.insert(routes).values(syntheticRoute());
    await expectPostgresError(
      () =>
        database.insert(activities).values(
          syntheticActivity({
            userId: syntheticIds.otherOwner,
            routeId: syntheticIds.route,
          }),
        ),
      '23503',
    );

    await database
      .insert(activities)
      .values(syntheticActivity({ routeId: syntheticIds.route }));
    await database.delete(routes).where(eq(routes.id, syntheticIds.route));
    const rows = await client`
      select id, user_id, route_id from trail.activities
      where id = ${syntheticIds.activity}
    `;
    expect(rows).toMatchObject([
      {
        id: syntheticIds.activity,
        user_id: syntheticIds.owner,
        route_id: null,
      },
    ]);
  });

  it('allows nullable accuracy and large sparse nonnegative sequences without treating sequence as point count', async () => {
    await database.insert(users).values(syntheticUser());
    await database.insert(activities).values(syntheticActivity());
    await database.insert(activityPoints).values([
      {
        activityId: syntheticIds.activity,
        seq: 7,
        latitude: 0,
        longitude: 0,
        recordedAt: new Date('2026-01-01T08:00:00.000Z'),
        accuracyM: null,
      },
      {
        activityId: syntheticIds.activity,
        seq: 2_000_000_000,
        latitude: 0,
        longitude: 0.001,
        recordedAt: new Date('2026-01-01T08:00:01.000Z'),
        accuracyM: null,
      },
    ]);
    const persistedSequences = await client<{ seq: number }[]>`
      select seq from trail.activity_points order by seq
    `;
    expect(persistedSequences).toEqual([{ seq: 7 }, { seq: 2_000_000_000 }]);
    await expectPostgresError(
      () =>
        database.insert(activityPoints).values({
          activityId: syntheticIds.activity,
          seq: -1,
          latitude: 0,
          longitude: 0,
          recordedAt: new Date('2026-01-01T08:00:02.000Z'),
        }),
      '23514',
    );
    await expectPostgresError(
      () =>
        database.insert(activityPoints).values({
          activityId: syntheticIds.activity,
          seq: 2_000_000_000,
          latitude: 0,
          longitude: 0.002,
          recordedAt: new Date('2026-01-01T08:00:02.000Z'),
        }),
      '23505',
    );
  });

  it('enforces one-based split indexes and rejects non-finite values in every floating metric table', async () => {
    await database.insert(users).values(syntheticUser());
    await database.insert(routes).values(syntheticRoute());
    await database.insert(activities).values(syntheticActivity());
    await database.insert(activitySplits).values({
      activityId: syntheticIds.activity,
      unitSystem: 'metric',
      splitIndex: 1,
      boundaryDistanceM: 1_000,
      distanceM: 1_000,
      durationS: 280,
    });
    await database.insert(activityElevationSamples).values({
      activityId: syntheticIds.activity,
      seq: 0,
      distanceM: 0,
      elapsedTimeS: 0,
      elevationM: 10,
    });
    await database.insert(activityPoints).values({
      activityId: syntheticIds.activity,
      seq: 0,
      latitude: 0,
      longitude: 0,
      recordedAt: new Date('2026-01-01T08:00:00.000Z'),
    });
    await database.insert(activityPhotos).values(photoValues());

    const invalidUpdates = [
      `update trail.routes set distance_m = 'Infinity'::double precision`,
      `update trail.activities set elevation_gain_m = 'NaN'::double precision`,
      `update trail.activity_points set accuracy_m = '-Infinity'::double precision`,
      `update trail.activity_splits set duration_s = 'Infinity'::double precision`,
      `update trail.activity_elevation_samples set elevation_m = 'NaN'::double precision`,
      `update trail.activity_photos set latitude = 'Infinity'::double precision, longitude = 0`,
    ];
    for (const statement of invalidUpdates) {
      await expectPostgresError(() => client.unsafe(statement), '23514');
    }
    const floatingColumns = await client<
      { table_name: string; column_name: string }[]
    >`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'trail' and data_type = 'double precision'
    `;
    const finiteChecks = await client<
      { table_name: string; definition: string }[]
    >`
      select relation.relname as table_name,
             pg_get_constraintdef(constraint_row.oid) as definition
      from pg_constraint constraint_row
      join pg_class relation on relation.oid = constraint_row.conrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'trail' and constraint_row.contype = 'c'
    `;
    for (const column of floatingColumns) {
      expect(
        finiteChecks.some(
          (constraintRow) =>
            constraintRow.table_name === column.table_name &&
            constraintRow.definition.includes(column.column_name) &&
            constraintRow.definition.includes('NaN'),
        ),
        `${column.table_name}.${column.column_name} must reject non-finite values`,
      ).toBe(true);
    }
    await expectPostgresError(
      () =>
        database.insert(activitySplits).values({
          activityId: syntheticIds.activity,
          unitSystem: 'imperial',
          splitIndex: 0,
          boundaryDistanceM: 1_609.344,
          distanceM: 1_609.344,
          durationS: 400,
        }),
      '23514',
    );
  });

  it('validates route waypoint shape/ranges and contract text bounds', async () => {
    await database.insert(users).values(syntheticUser());
    await expectPostgresError(
      () =>
        database.insert(routes).values(
          syntheticRoute({
            waypoints: [
              { lat: 0, lon: 0 },
              { lat: 1, lon: 1 },
            ],
          }),
        ),
      '23514',
    );
    await expectPostgresError(
      () =>
        database.insert(routes).values(
          syntheticRoute({
            waypoints: [
              { latitude: 0, longitude: 0 },
              { latitude: 91, longitude: 0 },
            ],
          }),
        ),
      '23514',
    );
    await expectPostgresError(
      () =>
        database.insert(routes).values(
          syntheticRoute({
            waypoints: Array.from({ length: 1_001 }, () => ({
              latitude: 0,
              longitude: 0,
            })),
          }),
        ),
      '23514',
    );
    await expectPostgresError(
      () =>
        database
          .insert(routes)
          .values(syntheticRoute({ name: 'x'.repeat(201) })),
      '23514',
    );
    await expectPostgresError(
      () =>
        database
          .insert(activities)
          .values(syntheticActivity({ title: 'x'.repeat(201) })),
      '23514',
    );
  });

  it('enforces wall-clock duration, ten photo slots, and owner-bound object keys', async () => {
    await database.insert(users).values([
      syntheticUser(),
      syntheticUser({
        id: syntheticIds.otherOwner,
        email: 'other.synthetic@example.test',
      }),
    ]);
    await expectPostgresError(
      () =>
        database.insert(activities).values(
          syntheticActivity({
            endedAt: new Date('2026-01-01T20:00:01.000Z'),
            elapsedTimeS: 43_200,
          }),
        ),
      '23514',
    );
    await database.insert(activities).values(syntheticActivity());
    await expectPostgresError(
      () =>
        database.insert(objectDeletionOutbox).values({
          ownerUserId: syntheticIds.owner,
          sourceActivityId: syntheticIds.activity,
          sourcePhotoId: syntheticIds.photo,
          objectKey: syntheticPhotoObjectKey(),
          lastErrorCode: 'INVALID-ERROR-CODE',
        }),
      '23514',
    );
    await expectPostgresError(
      () =>
        database.insert(activityPhotos).values({
          ...photoValues('00000000-0000-4000-8000-000000000600', 0),
          userId: syntheticIds.otherOwner,
          objectKey: syntheticPhotoObjectKey(
            syntheticIds.otherOwner,
            syntheticIds.activity,
            '00000000-0000-4000-8000-000000000600',
          ),
        }),
      '23503',
    );
    await expectPostgresError(
      () =>
        database.insert(activityPhotos).values({
          ...photoValues('00000000-0000-4000-8000-000000000601', 0),
          objectKey: syntheticPhotoObjectKey(
            syntheticIds.otherOwner,
            syntheticIds.activity,
            '00000000-0000-4000-8000-000000000601',
          ),
        }),
      '23514',
    );

    for (let sortOrder = 0; sortOrder < 10; sortOrder += 1) {
      const id = `00000000-0000-4000-8000-${String(500 + sortOrder).padStart(12, '0')}`;
      await database.insert(activityPhotos).values(photoValues(id, sortOrder));
    }
    await expectPostgresError(
      () =>
        database
          .insert(activityPhotos)
          .values(photoValues('00000000-0000-4000-8000-000000000599', 10)),
      '23514',
    );
  });

  it('atomically enqueues exact idempotent jobs before direct photo deletion and permits later purge', async () => {
    await database.insert(users).values(syntheticUser());
    await database.insert(activities).values(syntheticActivity());
    const photo = photoValues();
    await database.insert(activityPhotos).values(photo);
    await database.insert(objectDeletionOutbox).values({
      ownerUserId: syntheticIds.owner,
      sourceActivityId: syntheticIds.activity,
      sourcePhotoId: syntheticIds.photo,
      objectKey: photo.objectKey,
    });
    await database
      .delete(activityPhotos)
      .where(eq(activityPhotos.id, syntheticIds.photo));

    const jobs = await client`
      select owner_user_id, source_activity_id, source_photo_id, object_key, status
      from trail.object_deletion_outbox
    `;
    expect(jobs).toMatchObject([
      {
        owner_user_id: syntheticIds.owner,
        source_activity_id: syntheticIds.activity,
        source_photo_id: syntheticIds.photo,
        object_key: photo.objectKey,
        status: 'pending',
      },
    ]);
    await client`
      update trail.object_deletion_outbox
      set status = 'completed', completed_at = now(), updated_at = now()
      where source_photo_id = ${syntheticIds.photo}
    `;
    await database
      .delete(objectDeletionOutbox)
      .where(eq(objectDeletionOutbox.sourcePhotoId, syntheticIds.photo));
    expect(
      await client`select count(*)::integer as count from trail.object_deletion_outbox`,
    ).toMatchObject([{ count: 0 }]);
  });

  it('enqueues jobs that survive activity and account cascades', async () => {
    await database.insert(users).values(syntheticUser());
    await database.insert(activities).values(syntheticActivity());
    const secondPhotoId = '00000000-0000-4000-8000-000000000402';
    await database
      .insert(activityPhotos)
      .values([photoValues(), photoValues(secondPhotoId, 1)]);

    await database
      .delete(activities)
      .where(eq(activities.id, syntheticIds.activity));
    expect(
      await client`select count(*)::integer as count from trail.object_deletion_outbox`,
    ).toMatchObject([{ count: 2 }]);

    const accountActivityId = '00000000-0000-4000-8000-000000000202';
    const accountPhotoId = '00000000-0000-4000-8000-000000000403';
    await database.insert(routes).values(syntheticRoute());
    await database.insert(activities).values(
      syntheticActivity({
        id: accountActivityId,
        routeId: syntheticIds.route,
      }),
    );
    await database
      .insert(activityPhotos)
      .values(
        photoValues(accountPhotoId, 0, syntheticIds.owner, accountActivityId),
      );
    await database.delete(users).where(eq(users.id, syntheticIds.owner));

    const jobs = await client<
      {
        owner_user_id: string;
        source_activity_id: string;
        source_photo_id: string;
        object_key: string;
      }[]
    >`
      select owner_user_id, source_activity_id, source_photo_id, object_key
      from trail.object_deletion_outbox order by source_photo_id
    `;
    expect(jobs).toHaveLength(3);
    expect(jobs.every((job) => job.owner_user_id === syntheticIds.owner)).toBe(
      true,
    );
    expect(
      jobs.every(
        (job) =>
          job.object_key ===
          syntheticPhotoObjectKey(
            syntheticIds.owner,
            job.source_activity_id,
            job.source_photo_id,
          ),
      ),
    ).toBe(true);
    expect(jobs.map((job) => job.source_activity_id)).toContain(
      accountActivityId,
    );
    expect(
      await client`
        select
          (select count(*)::integer from trail.activities) as activities,
          (select count(*)::integer from trail.routes) as routes
      `,
    ).toMatchObject([{ activities: 0, routes: 0 }]);
  });

  it('rolls photo deletion back when the mandatory enqueue cannot succeed', async () => {
    await database.insert(users).values(syntheticUser());
    await database.insert(activities).values(syntheticActivity());
    await database.insert(activityPhotos).values(photoValues());
    await client.unsafe(
      'ALTER TABLE trail.object_deletion_outbox ADD CONSTRAINT test_reject_enqueue CHECK (false)',
    );
    await expectPostgresError(
      () =>
        database
          .delete(activityPhotos)
          .where(eq(activityPhotos.id, syntheticIds.photo)),
      '23514',
    );
    expect(
      await client`select count(*)::integer as count from trail.activity_photos`,
    ).toMatchObject([{ count: 1 }]);
    expect(
      await client`select count(*)::integer as count from trail.object_deletion_outbox`,
    ).toMatchObject([{ count: 0 }]);
    await client.unsafe(
      'ALTER TABLE trail.object_deletion_outbox DROP CONSTRAINT test_reject_enqueue',
    );
  });

  it('retains required owner/date and pending-work indexes', async () => {
    const indexes = await client<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'trail'
    `;
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain('activities_user_started_at_idx');
    expect(names).toContain('routes_user_created_at_idx');
    expect(names).toContain('activity_photos_user_id_idx');
    expect(names).toContain('object_deletion_outbox_pending_idx');
  });
});
