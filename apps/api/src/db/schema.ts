import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const trailSchema = pgSchema('trail');

const utcTimestamp = (name: string) =>
  timestamp(name, { mode: 'date', withTimezone: true });

export const users = trailSchema.table(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email'),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    units: text('units').notNull().default('metric'),
    defaultSport: text('default_sport').notNull().default('run'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    updatedAt: utcTimestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_email_normalized_unique')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} is not null`),
    check(
      'users_email_length_check',
      sql`${table.email} is null or length(trim(${table.email})) between 1 and 320`,
    ),
    check(
      'users_password_hash_format_check',
      sql`${table.passwordHash} is null or (length(${table.passwordHash}) <= 512 and (${table.passwordHash} ~ '^\\$argon2id\\$v=19\\$m=[0-9]+,t=[0-9]+,p=[0-9]+\\$[A-Za-z0-9+/]+={0,2}\\$[A-Za-z0-9+/]+={0,2}$' or ${table.passwordHash} ~ '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$'))`,
    ),
    check(
      'users_display_name_length_check',
      sql`length(trim(${table.displayName})) between 1 and 100`,
    ),
    check(
      'users_avatar_url_length_check',
      sql`${table.avatarUrl} is null or length(${table.avatarUrl}) between 1 and 2048`,
    ),
    check('users_units_check', sql`${table.units} in ('metric', 'imperial')`),
    check(
      'users_default_sport_check',
      sql`${table.defaultSport} in ('run', 'ride', 'walk', 'hike')`,
    ),
    check(
      'users_updated_at_check',
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const authIdentities = trailSchema.table(
  'auth_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('auth_identities_provider_subject_unique').on(
      table.provider,
      table.providerSubject,
    ),
    unique('auth_identities_user_provider_unique').on(
      table.userId,
      table.provider,
    ),
    index('auth_identities_user_id_idx').on(table.userId),
    check(
      'auth_identities_provider_check',
      sql`${table.provider} in ('password', 'apple', 'google')`,
    ),
    check(
      'auth_identities_subject_length_check',
      sql`length(${table.providerSubject}) between 1 and 2048`,
    ),
  ],
);

export const refreshTokenFamilies = trailSchema.table(
  'refresh_token_families',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceHint: text('device_hint'),
    expiresAt: utcTimestamp('expires_at').notNull(),
    revokedAt: utcTimestamp('revoked_at'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('refresh_token_families_user_id_idx').on(table.userId),
    check(
      'refresh_token_families_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'refresh_token_families_revocation_check',
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
    check(
      'refresh_token_families_device_hint_check',
      sql`${table.deviceHint} is null or length(trim(${table.deviceHint})) between 1 and 200`,
    ),
  ],
);

export const refreshTokens = trailSchema.table(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => refreshTokenFamilies.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    consumedAt: utcTimestamp('consumed_at'),
    revokedAt: utcTimestamp('revoked_at'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('refresh_tokens_hash_unique').on(table.tokenHash),
    unique('refresh_tokens_family_sequence_unique').on(
      table.familyId,
      table.sequence,
    ),
    index('refresh_tokens_family_id_idx').on(table.familyId),
    check('refresh_tokens_sequence_check', sql`${table.sequence} >= 0`),
    check(
      'refresh_tokens_hash_format_check',
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'refresh_tokens_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'refresh_tokens_consumed_check',
      sql`${table.consumedAt} is null or ${table.consumedAt} >= ${table.createdAt}`,
    ),
    check(
      'refresh_tokens_revoked_check',
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const routes = trailSchema.table(
  'routes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sportHint: text('sport_hint'),
    waypoints: jsonb('waypoints').notNull(),
    polyline: text('polyline').notNull(),
    distanceM: doublePrecision('distance_m').notNull(),
    elevationGainM: doublePrecision('elevation_gain_m'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    updatedAt: utcTimestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('routes_id_user_id_unique').on(table.id, table.userId),
    index('routes_user_created_at_idx').on(
      table.userId,
      table.createdAt.desc(),
    ),
    check(
      'routes_name_length_check',
      sql`length(trim(${table.name})) between 1 and 200`,
    ),
    check(
      'routes_sport_hint_check',
      sql`${table.sportHint} is null or ${table.sportHint} in ('run', 'ride', 'walk', 'hike')`,
    ),
    check(
      'routes_waypoints_check',
      sql`trail.valid_route_waypoints(${table.waypoints})`,
    ),
    check(
      'routes_polyline_length_check',
      sql`length(${table.polyline}) between 1 and 1000000`,
    ),
    check(
      'routes_distance_check',
      sql`${table.distanceM} >= 0 and ${table.distanceM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'routes_elevation_gain_check',
      sql`${table.elevationGainM} is null or (${table.elevationGainM} >= 0 and ${table.elevationGainM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision))`,
    ),
    check(
      'routes_updated_at_check',
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const activities = trailSchema.table(
  'activities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    routeId: uuid('route_id'),
    sport: text('sport').notNull(),
    title: text('title'),
    notes: text('notes'),
    startedAt: utcTimestamp('started_at').notNull(),
    endedAt: utcTimestamp('ended_at').notNull(),
    distanceM: doublePrecision('distance_m').notNull(),
    movingTimeS: integer('moving_time_s').notNull(),
    elapsedTimeS: integer('elapsed_time_s').notNull(),
    elevationGainM: doublePrecision('elevation_gain_m').notNull(),
    elevationLossM: doublePrecision('elevation_loss_m').notNull(),
    polyline: text('polyline').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    updatedAt: utcTimestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('activities_id_user_id_unique').on(table.id, table.userId),
    index('activities_user_started_at_idx').on(
      table.userId,
      table.startedAt.desc(),
    ),
    foreignKey({
      name: 'activities_route_owner_fk',
      columns: [table.routeId, table.userId],
      foreignColumns: [routes.id, routes.userId],
    }).onDelete('restrict'),
    check(
      'activities_sport_check',
      sql`${table.sport} in ('run', 'ride', 'walk', 'hike')`,
    ),
    check(
      'activities_title_length_check',
      sql`${table.title} is null or length(trim(${table.title})) between 1 and 200`,
    ),
    check(
      'activities_notes_length_check',
      sql`${table.notes} is null or length(${table.notes}) <= 10000`,
    ),
    check(
      'activities_time_bounds_check',
      sql`${table.endedAt} > ${table.startedAt} and ${table.endedAt} - ${table.startedAt} <= interval '12 hours'`,
    ),
    check(
      'activities_distance_check',
      sql`${table.distanceM} >= 0 and ${table.distanceM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activities_elapsed_time_check',
      sql`${table.elapsedTimeS} >= 0 and ${table.elapsedTimeS} <= 43200`,
    ),
    check(
      'activities_moving_time_check',
      sql`${table.movingTimeS} >= 0 and ${table.movingTimeS} <= ${table.elapsedTimeS}`,
    ),
    check(
      'activities_elevation_gain_check',
      sql`${table.elevationGainM} >= 0 and ${table.elevationGainM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activities_elevation_loss_check',
      sql`${table.elevationLossM} >= 0 and ${table.elevationLossM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activities_polyline_length_check',
      sql`length(${table.polyline}) between 1 and 1000000`,
    ),
    check(
      'activities_updated_at_check',
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const activityPoints = trailSchema.table(
  'activity_points',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    elevationM: doublePrecision('elevation_m'),
    recordedAt: utcTimestamp('recorded_at').notNull(),
    accuracyM: doublePrecision('accuracy_m'),
  },
  (table) => [
    unique('activity_points_activity_seq_unique').on(
      table.activityId,
      table.seq,
    ),
    index('activity_points_activity_recorded_at_idx').on(
      table.activityId,
      table.recordedAt,
    ),
    check('activity_points_seq_check', sql`${table.seq} >= 0`),
    check(
      'activity_points_latitude_check',
      sql`${table.latitude} between -90 and 90 and ${table.latitude} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activity_points_longitude_check',
      sql`${table.longitude} between -180 and 180 and ${table.longitude} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activity_points_elevation_check',
      sql`${table.elevationM} is null or ${table.elevationM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activity_points_accuracy_check',
      sql`${table.accuracyM} is null or (${table.accuracyM} >= 0 and ${table.accuracyM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision))`,
    ),
  ],
);

export const activitySplits = trailSchema.table(
  'activity_splits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    unitSystem: text('unit_system').notNull(),
    splitIndex: integer('split_index').notNull(),
    boundaryDistanceM: doublePrecision('boundary_distance_m').notNull(),
    distanceM: doublePrecision('distance_m').notNull(),
    durationS: doublePrecision('duration_s').notNull(),
  },
  (table) => [
    unique('activity_splits_activity_unit_index_unique').on(
      table.activityId,
      table.unitSystem,
      table.splitIndex,
    ),
    index('activity_splits_activity_id_idx').on(table.activityId),
    check(
      'activity_splits_unit_system_check',
      sql`${table.unitSystem} in ('metric', 'imperial')`,
    ),
    check('activity_splits_index_check', sql`${table.splitIndex} >= 1`),
    check(
      'activity_splits_boundary_check',
      sql`${table.boundaryDistanceM} > 0 and ${table.boundaryDistanceM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activity_splits_distance_check',
      sql`${table.distanceM} > 0 and ${table.distanceM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activity_splits_duration_check',
      sql`${table.durationS} >= 0 and ${table.durationS} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
  ],
);

export const activityElevationSamples = trailSchema.table(
  'activity_elevation_samples',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    distanceM: doublePrecision('distance_m').notNull(),
    elapsedTimeS: doublePrecision('elapsed_time_s').notNull(),
    elevationM: doublePrecision('elevation_m').notNull(),
    source: text('source').notNull().default('gps_smoothed'),
  },
  (table) => [
    unique('activity_elevation_activity_seq_unique').on(
      table.activityId,
      table.seq,
    ),
    index('activity_elevation_activity_id_idx').on(table.activityId),
    check('activity_elevation_seq_check', sql`${table.seq} >= 0`),
    check(
      'activity_elevation_distance_check',
      sql`${table.distanceM} >= 0 and ${table.distanceM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activity_elevation_time_check',
      sql`${table.elapsedTimeS} >= 0 and ${table.elapsedTimeS} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activity_elevation_value_check',
      sql`${table.elevationM} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)`,
    ),
    check(
      'activity_elevation_source_check',
      sql`${table.source} in ('gps_smoothed', 'dem')`,
    ),
  ],
);

export const activityPhotos = trailSchema.table(
  'activity_photos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    activityId: uuid('activity_id').notNull(),
    userId: uuid('user_id').notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status').notNull().default('pending'),
    contentType: text('content_type'),
    byteSize: integer('byte_size'),
    width: integer('width'),
    height: integer('height'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    capturedAt: utcTimestamp('captured_at'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    updatedAt: utcTimestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('activity_photos_object_key_unique').on(table.objectKey),
    unique('activity_photos_activity_sort_unique').on(
      table.activityId,
      table.sortOrder,
    ),
    index('activity_photos_activity_id_idx').on(table.activityId),
    index('activity_photos_user_id_idx').on(table.userId),
    foreignKey({
      name: 'activity_photos_activity_owner_fk',
      columns: [table.activityId, table.userId],
      foreignColumns: [activities.id, activities.userId],
    }).onDelete('cascade'),
    check(
      'activity_photos_object_key_owner_check',
      sql`length(${table.objectKey}) <= 1024 and ${table.objectKey} = 'users/' || ${table.userId}::text || '/activities/' || ${table.activityId}::text || '/photos/' || ${table.id}::text`,
    ),
    check(
      'activity_photos_status_check',
      sql`${table.status} in ('pending', 'uploading', 'ready', 'failed')`,
    ),
    check(
      'activity_photos_content_type_check',
      sql`${table.contentType} is null or ${table.contentType} in ('image/jpeg', 'image/heic', 'image/webp')`,
    ),
    check(
      'activity_photos_byte_size_check',
      sql`${table.byteSize} is null or (${table.byteSize} > 0 and ${table.byteSize} <= 10485760)`,
    ),
    check(
      'activity_photos_dimensions_check',
      sql`(${table.width} is null) = (${table.height} is null) and (${table.width} is null or (${table.width} > 0 and ${table.height} > 0))`,
    ),
    check(
      'activity_photos_location_check',
      sql`(${table.latitude} is null) = (${table.longitude} is null) and (${table.latitude} is null or (${table.latitude} between -90 and 90 and ${table.longitude} between -180 and 180 and ${table.latitude} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision) and ${table.longitude} not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)))`,
    ),
    check(
      'activity_photos_sort_order_check',
      sql`${table.sortOrder} >= 0 and ${table.sortOrder} < 10`,
    ),
    check(
      'activity_photos_updated_at_check',
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const objectDeletionOutbox = trailSchema.table(
  'object_deletion_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id').notNull(),
    sourceActivityId: uuid('source_activity_id').notNull(),
    sourcePhotoId: uuid('source_photo_id').notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: utcTimestamp('next_attempt_at').defaultNow().notNull(),
    completedAt: utcTimestamp('completed_at'),
    lastErrorCode: text('last_error_code'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    updatedAt: utcTimestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('object_deletion_outbox_object_key_unique').on(table.objectKey),
    unique('object_deletion_outbox_source_photo_unique').on(
      table.sourcePhotoId,
    ),
    index('object_deletion_outbox_pending_idx')
      .on(table.nextAttemptAt)
      .where(sql`${table.status} in ('pending', 'retry')`),
    index('object_deletion_outbox_owner_user_id_idx').on(table.ownerUserId),
    check(
      'object_deletion_outbox_object_key_owner_check',
      sql`length(${table.objectKey}) <= 1024 and ${table.objectKey} = 'users/' || ${table.ownerUserId}::text || '/activities/' || ${table.sourceActivityId}::text || '/photos/' || ${table.sourcePhotoId}::text`,
    ),
    check(
      'object_deletion_outbox_status_check',
      sql`${table.status} in ('pending', 'retry', 'completed')`,
    ),
    check(
      'object_deletion_outbox_attempt_count_check',
      sql`${table.attemptCount} between 0 and 2147483647`,
    ),
    check(
      'object_deletion_outbox_error_code_check',
      sql`${table.lastErrorCode} is null or (length(${table.lastErrorCode}) between 1 and 100 and ${table.lastErrorCode} ~ '^[a-z0-9_]+$')`,
    ),
    check(
      'object_deletion_outbox_completion_check',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
    check(
      'object_deletion_outbox_updated_at_check',
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const foundationSchema = {
  users,
  authIdentities,
  refreshTokenFamilies,
  refreshTokens,
  activities,
  activityPoints,
  activitySplits,
  activityElevationSamples,
  routes,
  activityPhotos,
  objectDeletionOutbox,
};
