import * as SQLite from 'expo-sqlite';
import type {
  CreateActivityRequest,
  CreateRouteRequest,
  Route,
  UpdateRouteRequest,
} from '@trail/contracts';
import { encodePolyline, trackDistanceM, type TrackPoint } from '@trail/domain';
import type {
  SyncFailureKind,
  SyncJob,
  SyncRepository,
} from '../features/activity-sync/sync-engine';
import { purgeManagedOwnerPhotos } from '../features/photos/photo-file-store';
import {
  ROUTE_TOMBSTONE_RETENTION_MS,
  type CachedRoute,
  type RouteRepository,
  type RouteSyncJob,
} from '../features/routes/route-cache';
import { recordingRoutePayload } from '../features/routes/recording-route';
import type {
  NewPendingPhoto,
  PendingPhoto,
  PendingPhotoRepository,
  PendingPhotoStatus,
} from '../features/photos/photo-types';
import { assertTransition } from '../features/record/recording-state-machine';
import {
  ABANDONED_DRAFT_RETENTION_MS,
  MAX_DISPLAY_POINTS,
  MAX_RECORDING_POINTS,
  UNRESOLVED_CLEANUP_RETENTION_MS,
  type NewRecordingSession,
  type PersistedRecordingState,
  type RecordingRepository,
  type RecordingSession,
  type SequencedPoint,
} from '../features/record/recording-types';
import { getOrCreateRecordingDatabaseKey } from './recording-database-key';

const DATABASE_NAME = 'trail-recording.db';
const LEGACY_UNOWNED = '__unowned_v1__';

interface SessionRow {
  id: string;
  owner_user_id: string;
  state: PersistedRecordingState;
  sport: RecordingSession['sport'];
  route_id: string | null;
  route_polyline: string | null;
  route_waypoints_json: string | null;
  background_enabled: number;
  created_at_ms: number;
  started_at_ms: number | null;
  updated_at_ms: number;
  stopped_at_ms: number | null;
  paused_at_ms: number | null;
  accumulated_paused_ms: number;
  distance_m: number;
  accepted_point_count: number;
  last_sequence: number;
  latest_raw_accuracy_m: number | null;
  latest_raw_fix_at_ms: number | null;
  stop_reason: RecordingSession['stopReason'];
  error_code: RecordingSession['errorCode'];
}
interface SyncJobRow {
  id: string;
  entity_id: string;
  owner_user_id: string;
  attempt_count: number;
}
interface PendingPhotoRow {
  id: string;
  owner_user_id: string;
  activity_id: string;
  server_photo_id: string | null;
  local_uri: string;
  status: PendingPhotoStatus;
  input_mime: PendingPhoto['inputMime'];
  input_size_bytes: number;
  progress: number;
  attempt_count: number;
  next_attempt_at_ms: number;
  last_safe_error_code: string | null;
  lease_expires_at_ms: number | null;
}
interface CachedRouteRow {
  owner_user_id: string;
  id: string;
  name: string;
  sport_hint: Route['sport_hint'];
  waypoints_json: string;
  polyline: string;
  distance_m: number;
  elevation_gain_m: number | null;
  created_at: string;
  updated_at: string;
  sync_status: CachedRoute['sync_status'];
  tombstone: number;
  revision: number;
  deleted_at_ms: number | null;
}
interface RouteSyncJobRow {
  id: string;
  owner_user_id: string;
  route_id: string;
  operation: RouteSyncJob['operation'];
  payload_json: string | null;
  attempt_count: number;
  next_attempt_at_ms: number;
  status: RouteSyncJob['status'];
  revision: number;
}
interface PauseRow {
  started_at_ms: number;
  ended_at_ms: number;
}
interface PointRow {
  sequence: number;
  latitude: number;
  longitude: number;
  elevation_m: number | null;
  accuracy_m: number | null;
  recorded_at_ms: number;
}

const MIGRATION_1 = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS recording_sessions (
 id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL CHECK (state IN ('starting','recording','paused','stopping','saving','local_saved')),
 sport TEXT NOT NULL CHECK (sport IN ('run','ride','walk','hike')), route_id TEXT, created_at_ms INTEGER NOT NULL,
 started_at_ms INTEGER, updated_at_ms INTEGER NOT NULL, stopped_at_ms INTEGER, paused_at_ms INTEGER,
 accumulated_paused_ms INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_paused_ms >= 0), distance_m REAL NOT NULL DEFAULT 0 CHECK (distance_m >= 0),
 accepted_point_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_point_count BETWEEN 0 AND 100000), last_sequence INTEGER NOT NULL DEFAULT -1,
 stop_reason TEXT CHECK (stop_reason IS NULL OR stop_reason IN ('user','duration_limit','point_limit'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_recording ON recording_sessions((1)) WHERE state IN ('starting','recording','paused','stopping','saving');
CREATE TABLE IF NOT EXISTS recording_points (
 session_id TEXT NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE, sequence INTEGER NOT NULL CHECK (sequence >= 0),
 latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90), longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
 elevation_m REAL, accuracy_m REAL CHECK (accuracy_m IS NULL OR accuracy_m >= 0), recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
 PRIMARY KEY (session_id, sequence)
);
CREATE INDEX IF NOT EXISTS recording_points_time ON recording_points(session_id, recorded_at_ms);
CREATE TABLE IF NOT EXISTS sync_jobs (
 id TEXT PRIMARY KEY NOT NULL, entity_id TEXT NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
 operation TEXT NOT NULL DEFAULT 'create_activity', state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','uploading','needs_attention','synced')),
 attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at_ms INTEGER NOT NULL, last_safe_error_code TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_jobs_due ON sync_jobs(state, next_attempt_at_ms);
CREATE TABLE IF NOT EXISTS pending_photos (
 id TEXT PRIMARY KEY NOT NULL, activity_id TEXT NOT NULL, local_uri TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','uploading','needs_attention','uploaded')), media_type TEXT, byte_size INTEGER,
 attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at_ms INTEGER NOT NULL, last_safe_error_code TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_photos_due ON pending_photos(state, next_attempt_at_ms);
PRAGMA user_version = 1;`;

const MIGRATION_2 = `
ALTER TABLE recording_sessions ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT '${LEGACY_UNOWNED}';
ALTER TABLE recording_sessions ADD COLUMN background_enabled INTEGER NOT NULL DEFAULT 0 CHECK (background_enabled IN (0,1));
ALTER TABLE recording_sessions ADD COLUMN latest_raw_accuracy_m REAL;
ALTER TABLE recording_sessions ADD COLUMN latest_raw_fix_at_ms INTEGER;
UPDATE recording_sessions SET state='local_saved',stopped_at_ms=COALESCE(stopped_at_ms,updated_at_ms) WHERE owner_user_id='${LEGACY_UNOWNED}' AND state IN ('starting','recording','paused','stopping','saving');
ALTER TABLE sync_jobs ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT '${LEGACY_UNOWNED}';
UPDATE sync_jobs SET owner_user_id=COALESCE((SELECT owner_user_id FROM recording_sessions WHERE id=entity_id),'${LEGACY_UNOWNED}');
ALTER TABLE pending_photos ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT '${LEGACY_UNOWNED}';
CREATE INDEX IF NOT EXISTS recording_sessions_owner_state ON recording_sessions(owner_user_id,state,updated_at_ms);
CREATE INDEX IF NOT EXISTS sync_jobs_owner_state ON sync_jobs(owner_user_id,state,next_attempt_at_ms);
CREATE INDEX IF NOT EXISTS pending_photos_owner_state ON pending_photos(owner_user_id,state,next_attempt_at_ms);
PRAGMA user_version = 2;`;

const MIGRATION_3 = `
DROP INDEX IF EXISTS one_active_recording;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_recording_per_owner
  ON recording_sessions(owner_user_id) WHERE state IN ('starting','recording','paused','stopping','saving');
CREATE TABLE IF NOT EXISTS owner_cleanup_markers (
  owner_user_id TEXT PRIMARY KEY NOT NULL,
  created_at_ms INTEGER NOT NULL
);
PRAGMA user_version = 3;`;

const MIGRATION_4 = `
ALTER TABLE owner_cleanup_markers ADD COLUMN state TEXT NOT NULL DEFAULT 'prepared'
  CHECK (state IN ('prepared','confirmed','unresolved'));
ALTER TABLE recording_sessions ADD COLUMN error_code TEXT
  CHECK (error_code IS NULL OR error_code IN ('task_payload_overflow','persistence_failed'));
PRAGMA user_version = 4;`;

const MIGRATION_5 = `
UPDATE sync_jobs SET state='pending' WHERE state='uploading';
DELETE FROM sync_jobs WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM sync_jobs GROUP BY entity_id,operation
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_entity_operation_unique ON sync_jobs(entity_id,operation);
PRAGMA user_version = 5;`;

const MIGRATION_6 = `
CREATE TABLE IF NOT EXISTS recording_pauses (
 session_id TEXT NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK (sequence >= 0), started_at_ms INTEGER NOT NULL,
 ended_at_ms INTEGER, PRIMARY KEY (session_id,sequence),
 CHECK (ended_at_ms IS NULL OR ended_at_ms > started_at_ms)
);
INSERT OR IGNORE INTO recording_pauses (session_id,sequence,started_at_ms,ended_at_ms)
 SELECT id,0,paused_at_ms,CASE WHEN state='paused' THEN NULL ELSE COALESCE(stopped_at_ms,updated_at_ms) END
 FROM recording_sessions WHERE paused_at_ms IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_open_pause_per_session ON recording_pauses(session_id) WHERE ended_at_ms IS NULL;
PRAGMA user_version = 6;`;

const MIGRATION_7 = `
ALTER TABLE pending_photos RENAME TO pending_photos_legacy;
CREATE TABLE pending_photos (
 id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, activity_id TEXT NOT NULL,
 server_photo_id TEXT, local_uri TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','completing','processing','needs_attention')),
 input_mime TEXT NOT NULL CHECK (input_mime IN ('image/jpeg','image/heic','image/webp')),
 input_size_bytes INTEGER NOT NULL CHECK (input_size_bytes BETWEEN 1 AND 10485760),
 progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
 attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at_ms INTEGER NOT NULL,
 last_safe_error_code TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
);
INSERT INTO pending_photos (id,owner_user_id,activity_id,local_uri,status,input_mime,input_size_bytes,progress,attempt_count,next_attempt_at_ms,last_safe_error_code,created_at_ms,updated_at_ms)
 SELECT id,owner_user_id,activity_id,local_uri,
  CASE WHEN state='uploaded' THEN 'processing' WHEN state='uploading' THEN 'pending' ELSE state END,
  CASE WHEN media_type IN ('image/jpeg','image/heic','image/webp') THEN media_type ELSE 'image/jpeg' END,
  CASE WHEN byte_size BETWEEN 1 AND 10485760 THEN byte_size ELSE 1 END,
  CASE WHEN state='uploaded' THEN 100 ELSE 0 END,attempt_count,next_attempt_at_ms,last_safe_error_code,created_at_ms,updated_at_ms
 FROM pending_photos_legacy;
DROP TABLE pending_photos_legacy;
CREATE INDEX pending_photos_due ON pending_photos(owner_user_id,status,next_attempt_at_ms);
CREATE INDEX pending_photos_activity ON pending_photos(owner_user_id,activity_id,created_at_ms);
CREATE UNIQUE INDEX pending_photos_server_id ON pending_photos(server_photo_id) WHERE server_photo_id IS NOT NULL;
PRAGMA user_version = 7;`;

const MIGRATION_8 = `
ALTER TABLE pending_photos ADD COLUMN lease_expires_at_ms INTEGER;
UPDATE pending_photos SET status=CASE WHEN server_photo_id IS NULL THEN 'pending' ELSE 'completing' END,lease_expires_at_ms=NULL
 WHERE status IN ('uploading','completing');
PRAGMA user_version = 8;`;

const MIGRATION_9 = `
ALTER TABLE recording_sessions ADD COLUMN route_polyline TEXT;
ALTER TABLE recording_sessions ADD COLUMN route_waypoints_json TEXT;
CREATE TABLE IF NOT EXISTS cached_routes (
 owner_user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, sport_hint TEXT,
 waypoints_json TEXT NOT NULL, polyline TEXT NOT NULL, distance_m REAL NOT NULL,
 elevation_gain_m REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 sync_status TEXT NOT NULL CHECK(sync_status IN ('synced','pending','needs_attention')),
 tombstone INTEGER NOT NULL DEFAULT 0 CHECK(tombstone IN (0,1)),
 PRIMARY KEY(owner_user_id,id)
);
CREATE INDEX IF NOT EXISTS cached_routes_owner_updated ON cached_routes(owner_user_id,tombstone,updated_at DESC);
CREATE TABLE IF NOT EXISTS route_sync_jobs (
 id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, route_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')), payload_json TEXT,
 attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at_ms INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','needs_attention')),
 UNIQUE(owner_user_id,route_id)
);
CREATE INDEX IF NOT EXISTS route_sync_jobs_due ON route_sync_jobs(owner_user_id,status,next_attempt_at_ms);
PRAGMA user_version = 9;`;

const MIGRATION_10 = `
ALTER TABLE cached_routes ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
ALTER TABLE cached_routes ADD COLUMN deleted_at_ms INTEGER;
ALTER TABLE route_sync_jobs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
UPDATE cached_routes SET revision=1 WHERE sync_status<>'synced' OR tombstone=1;
UPDATE route_sync_jobs SET revision=1;
PRAGMA user_version = 10;`;

function mapSession(row: SessionRow): RecordingSession {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    state: row.state,
    sport: row.sport,
    routeId: row.route_id,
    routePolyline: row.route_polyline,
    routeWaypoints: row.route_waypoints_json
      ? (JSON.parse(row.route_waypoints_json) as readonly {
          latitude: number;
          longitude: number;
        }[])
      : [],
    backgroundEnabled: row.background_enabled === 1,
    createdAtMs: row.created_at_ms,
    startedAtMs: row.started_at_ms,
    updatedAtMs: row.updated_at_ms,
    stoppedAtMs: row.stopped_at_ms,
    pausedAtMs: row.paused_at_ms,
    accumulatedPausedMs: row.accumulated_paused_ms,
    distanceM: row.distance_m,
    acceptedPointCount: row.accepted_point_count,
    lastSequence: row.last_sequence,
    latestRawAccuracyM: row.latest_raw_accuracy_m,
    latestRawFixAtMs: row.latest_raw_fix_at_ms,
    stopReason: row.stop_reason,
    errorCode: row.error_code,
  };
}
function mapPoint(row: PointRow): SequencedPoint {
  return {
    sequence: row.sequence,
    latitude: row.latitude,
    longitude: row.longitude,
    elevationM: row.elevation_m,
    accuracyM: row.accuracy_m,
    timestampMs: row.recorded_at_ms,
  };
}
function mapCachedRoute(row: CachedRouteRow): CachedRoute {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    name: row.name,
    sport_hint: row.sport_hint,
    waypoints: JSON.parse(row.waypoints_json) as Route['waypoints'],
    polyline: row.polyline,
    distance_m: row.distance_m,
    elevation_gain_m: row.elevation_gain_m,
    created_at: row.created_at,
    updated_at: row.updated_at,
    sync_status: row.sync_status,
    revision: row.revision,
  };
}
function mapRouteSyncJob(row: RouteSyncJobRow): RouteSyncJob {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    routeId: row.route_id,
    operation: row.operation,
    payload: row.payload_json
      ? (JSON.parse(row.payload_json) as
          | CreateRouteRequest
          | UpdateRouteRequest)
      : null,
    attemptCount: row.attempt_count,
    nextAttemptAtMs: row.next_attempt_at_ms,
    status: row.status,
    revision: row.revision,
  };
}
function mapPendingPhoto(row: PendingPhotoRow): PendingPhoto {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    activityId: row.activity_id,
    serverPhotoId: row.server_photo_id,
    localUri: row.local_uri,
    status: row.status,
    inputMime: row.input_mime,
    inputSizeBytes: row.input_size_bytes,
    progress: row.progress,
    attemptCount: row.attempt_count,
    nextAttemptAtMs: row.next_attempt_at_ms,
    lastSafeErrorCode: row.last_safe_error_code,
    leaseExpiresAtMs: row.lease_expires_at_ms,
  };
}

export class PointLimitReachedError extends Error {
  constructor() {
    super('The 100,000-point recording limit was reached.');
  }
}

export class SQLiteRecordingRepository
  implements
    RecordingRepository,
    SyncRepository,
    PendingPhotoRepository,
    RouteRepository
{
  private databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
  private migrationPromise: Promise<void> | null = null;

  private async database(): Promise<SQLite.SQLiteDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = (async () => {
        const key = await getOrCreateRecordingDatabaseKey();
        const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
        // SQLCipher requires keying before every other statement. The validated hex key is never logged.
        await db.execAsync(`PRAGMA key = "x'${key}'";`);
        return db;
      })();
    }
    try {
      return await this.databasePromise;
    } catch (error) {
      this.databasePromise = null;
      throw error;
    }
  }
  private async runMigration(db: SQLite.SQLiteDatabase, sql: string) {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(sql);
    });
  }
  async migrate(): Promise<void> {
    if (!this.migrationPromise) {
      this.migrationPromise = (async () => {
        const db = await this.database();
        let version =
          (
            await db.getFirstAsync<{ user_version: number }>(
              'PRAGMA user_version',
            )
          )?.user_version ?? 0;
        if (version < 1) {
          await this.runMigration(db, MIGRATION_1);
          version = 1;
        }
        if (version < 2) {
          await this.runMigration(db, MIGRATION_2);
          version = 2;
        }
        if (version < 3) {
          await this.runMigration(db, MIGRATION_3);
          version = 3;
        }
        if (version < 4) {
          await this.runMigration(db, MIGRATION_4);
          version = 4;
        }
        if (version < 5) {
          await this.runMigration(db, MIGRATION_5);
          version = 5;
        }
        if (version < 6) {
          await this.runMigration(db, MIGRATION_6);
          version = 6;
        }
        if (version < 7) {
          await this.runMigration(db, MIGRATION_7);
          version = 7;
        }
        if (version < 8) {
          await this.runMigration(db, MIGRATION_8);
          version = 8;
        }
        if (version < 9) {
          await this.runMigration(db, MIGRATION_9);
          version = 9;
        }
        if (version < 10) await this.runMigration(db, MIGRATION_10);
        await db.execAsync(
          'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA cipher_memory_security = ON; PRAGMA secure_delete = ON;',
        );
      })();
    }
    try {
      await this.migrationPromise;
    } catch (error) {
      this.migrationPromise = null;
      this.databasePromise = null;
      throw error;
    }
  }
  async createRecordingSession(
    input: NewRecordingSession,
  ): Promise<RecordingSession> {
    await this.migrate();
    await (
      await this.database()
    ).runAsync(
      `INSERT INTO recording_sessions (id,owner_user_id,state,sport,route_id,route_polyline,route_waypoints_json,background_enabled,created_at_ms,started_at_ms,updated_at_ms)
       VALUES (?,?,'recording',?,?,?,?,?,?, ?,?)`,
      input.id,
      input.ownerUserId,
      input.sport,
      input.routeId ?? null,
      input.routePolyline ?? null,
      input.routeWaypoints ? JSON.stringify(input.routeWaypoints) : null,
      input.backgroundEnabled ? 1 : 0,
      input.nowMs,
      input.nowMs,
      input.nowMs,
    );
    return (await this.getSession(input.ownerUserId, input.id))!;
  }
  async reconcileOwner(
    ownerUserId: string,
    nowMs: number,
  ): Promise<RecordingSession | null> {
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const quarantined = await tx.getAllAsync<{ id: string }>(
        `SELECT id FROM recording_sessions WHERE owner_user_id<>? AND state='recording'`,
        ownerUserId,
      );
      await tx.runAsync(
        `UPDATE recording_sessions SET state='paused',paused_at_ms=?,updated_at_ms=? WHERE owner_user_id<>? AND state='recording'`,
        nowMs,
        nowMs,
        ownerUserId,
      );
      for (const session of quarantined)
        await tx.runAsync(
          `INSERT OR IGNORE INTO recording_pauses (session_id,sequence,started_at_ms)
           SELECT ?,COALESCE(MAX(sequence)+1,0),? FROM recording_pauses WHERE session_id=?`,
          session.id,
          nowMs,
          session.id,
        );
      await tx.runAsync(
        `UPDATE recording_sessions SET state='recording',started_at_ms=COALESCE(started_at_ms,created_at_ms),updated_at_ms=? WHERE owner_user_id=? AND state='starting'`,
        nowMs,
        ownerUserId,
      );
      const saving = await tx.getFirstAsync<SessionRow>(
        `SELECT * FROM recording_sessions WHERE owner_user_id=? AND state='saving' LIMIT 1`,
        ownerUserId,
      );
      if (saving) {
        await tx.runAsync(
          `UPDATE recording_sessions SET state='local_saved',updated_at_ms=? WHERE id=? AND owner_user_id=?`,
          nowMs,
          saving.id,
          ownerUserId,
        );
        await tx.runAsync(
          `INSERT OR IGNORE INTO sync_jobs (id,entity_id,owner_user_id,state,next_attempt_at_ms,created_at_ms,updated_at_ms) VALUES (?, ?, ?,'pending',?,?,?)`,
          `recovered-${saving.id}`,
          saving.id,
          ownerUserId,
          nowMs,
          nowMs,
          nowMs,
        );
      }
    });
    return this.getRecoverableSession(ownerUserId);
  }
  async getSession(ownerUserId: string, id: string) {
    const row = await (
      await this.database()
    ).getFirstAsync<SessionRow>(
      'SELECT * FROM recording_sessions WHERE id=? AND owner_user_id=?',
      id,
      ownerUserId,
    );
    return row ? mapSession(row) : null;
  }
  async getActiveSessionForBackground() {
    const rows = await (
      await this.database()
    ).getAllAsync<SessionRow>(
      `SELECT * FROM recording_sessions WHERE state='recording' AND background_enabled=1 ORDER BY updated_at_ms DESC LIMIT 2`,
    );
    return rows.length === 1 && rows[0] ? mapSession(rows[0]) : null;
  }
  async quarantineCollectingSessions(
    ownerUserId: string | null,
    nowMs: number,
  ) {
    const ownerClause = ownerUserId === null ? '' : ' AND owner_user_id=?';
    const parameters =
      ownerUserId === null ? [nowMs, nowMs] : [nowMs, nowMs, ownerUserId];
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const sessions = await tx.getAllAsync<{ id: string }>(
        `SELECT id FROM recording_sessions WHERE state='recording'${ownerClause}`,
        ...(ownerUserId === null ? [] : [ownerUserId]),
      );
      await tx.runAsync(
        `UPDATE recording_sessions SET state='paused',paused_at_ms=?,updated_at_ms=? WHERE state='recording'${ownerClause}`,
        ...parameters,
      );
      for (const session of sessions)
        await tx.runAsync(
          `INSERT OR IGNORE INTO recording_pauses (session_id,sequence,started_at_ms)
           SELECT ?,COALESCE(MAX(sequence)+1,0),? FROM recording_pauses WHERE session_id=?`,
          session.id,
          nowMs,
          session.id,
        );
    });
  }
  async getRecoverableSession(ownerUserId: string) {
    const row = await (
      await this.database()
    ).getFirstAsync<SessionRow>(
      `SELECT * FROM recording_sessions WHERE owner_user_id=? AND state IN ('starting','recording','paused','stopping','saving') ORDER BY updated_at_ms DESC LIMIT 1`,
      ownerUserId,
    );
    return row ? mapSession(row) : null;
  }
  async getLatestSession(ownerUserId: string) {
    const row = await (
      await this.database()
    ).getFirstAsync<SessionRow>(
      'SELECT * FROM recording_sessions WHERE owner_user_id=? ORDER BY updated_at_ms DESC LIMIT 1',
      ownerUserId,
    );
    return row ? mapSession(row) : null;
  }
  async getDisplayPoints(
    ownerUserId: string,
    sessionId: string,
    maximum = MAX_DISPLAY_POINTS,
  ) {
    const db = await this.database();
    const owned = await this.getSession(ownerUserId, sessionId);
    if (!owned) return [];
    const cap = Math.max(2, Math.min(MAX_DISPLAY_POINTS, maximum));
    const step = Math.max(1, Math.ceil(owned.acceptedPointCount / (cap - 1)));
    const rows = await db.getAllAsync<PointRow>(
      `SELECT sequence,latitude,longitude,elevation_m,accuracy_m,recorded_at_ms FROM recording_points
       WHERE session_id=? AND (sequence=0 OR sequence=? OR sequence % ?=0) ORDER BY sequence LIMIT ?`,
      sessionId,
      owned.lastSequence,
      step,
      cap,
    );
    return rows.map(mapPoint);
  }
  async getHudPoints(ownerUserId: string, sessionId: string) {
    if (!(await this.getSession(ownerUserId, sessionId))) return [];
    const rows = await (
      await this.database()
    ).getAllAsync<PointRow>(
      `SELECT sequence,latitude,longitude,elevation_m,accuracy_m,recorded_at_ms FROM recording_points WHERE session_id=? ORDER BY sequence DESC LIMIT 2`,
      sessionId,
    );
    return rows.reverse().map(mapPoint);
  }
  async getLastPoint(ownerUserId: string, sessionId: string) {
    return (await this.getHudPoints(ownerUserId, sessionId)).at(-1) ?? null;
  }
  async transition(
    ownerUserId: string,
    sessionId: string,
    from: PersistedRecordingState,
    to: PersistedRecordingState,
    nowMs: number,
    patch: Partial<
      Pick<
        RecordingSession,
        | 'startedAtMs'
        | 'stoppedAtMs'
        | 'pausedAtMs'
        | 'accumulatedPausedMs'
        | 'stopReason'
        | 'errorCode'
      >
    > = {},
  ) {
    assertTransition(from, to);
    const db = await this.database();
    let changes = 0;
    await db.withExclusiveTransactionAsync(async (tx) => {
      const result = await tx.runAsync(
        `UPDATE recording_sessions SET state=?,updated_at_ms=?,started_at_ms=COALESCE(?,started_at_ms),stopped_at_ms=COALESCE(?,stopped_at_ms),paused_at_ms=?,accumulated_paused_ms=COALESCE(?,accumulated_paused_ms),stop_reason=COALESCE(?,stop_reason),error_code=CASE WHEN ?=1 THEN ? ELSE error_code END WHERE id=? AND owner_user_id=? AND state=?`,
        to,
        nowMs,
        patch.startedAtMs ?? null,
        patch.stoppedAtMs ?? null,
        patch.pausedAtMs ?? null,
        patch.accumulatedPausedMs ?? null,
        patch.stopReason ?? null,
        patch.errorCode !== undefined ? 1 : 0,
        patch.errorCode ?? null,
        sessionId,
        ownerUserId,
        from,
      );
      changes = result.changes;
      if (changes !== 1) return;
      if (from === 'recording' && to === 'paused')
        await tx.runAsync(
          `INSERT INTO recording_pauses (session_id,sequence,started_at_ms)
           SELECT ?,COALESCE(MAX(sequence)+1,0),? FROM recording_pauses WHERE session_id=?`,
          sessionId,
          nowMs,
          sessionId,
        );
      if (from === 'paused' && to !== 'paused')
        await tx.runAsync(
          `UPDATE recording_pauses SET ended_at_ms=? WHERE session_id=? AND ended_at_ms IS NULL`,
          nowMs,
          sessionId,
        );
    });
    if (changes !== 1)
      throw new Error('Recording state changed or is not owned by this user.');
    return (await this.getSession(ownerUserId, sessionId))!;
  }
  async markRecordingError(
    ownerUserId: string,
    sessionId: string,
    errorCode: Exclude<RecordingSession['errorCode'], null>,
    nowMs: number,
  ) {
    const session = await this.getSession(ownerUserId, sessionId);
    if (session?.state === 'recording')
      await this.transition(
        ownerUserId,
        sessionId,
        'recording',
        'paused',
        nowMs,
        { pausedAtMs: nowMs, errorCode },
      );
  }
  async recordRawFix(
    ownerUserId: string,
    sessionId: string,
    accuracyM: number | null,
    timestampMs: number,
  ) {
    await (
      await this.database()
    ).runAsync(
      `UPDATE recording_sessions SET latest_raw_accuracy_m=?,latest_raw_fix_at_ms=? WHERE id=? AND owner_user_id=? AND state='recording' AND (latest_raw_fix_at_ms IS NULL OR latest_raw_fix_at_ms < ?)`,
      accuracyM,
      timestampMs,
      sessionId,
      ownerUserId,
      timestampMs,
    );
  }
  async appendAcceptedPoints(
    ownerUserId: string,
    sessionId: string,
    points: readonly TrackPoint[],
    distanceDeltaM: number,
    nowMs: number,
  ) {
    if (!points.length) return (await this.getSession(ownerUserId, sessionId))!;
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const session = await tx.getFirstAsync<SessionRow>(
        'SELECT * FROM recording_sessions WHERE id=? AND owner_user_id=?',
        sessionId,
        ownerUserId,
      );
      if (!session || session.state !== 'recording')
        throw new Error('Points may only be appended to the owner recording.');
      if (session.accepted_point_count + points.length > MAX_RECORDING_POINTS)
        throw new PointLimitReachedError();
      let sequence = session.last_sequence;
      for (const point of points) {
        sequence += 1;
        await tx.runAsync(
          `INSERT INTO recording_points (session_id,sequence,latitude,longitude,elevation_m,accuracy_m,recorded_at_ms) VALUES (?,?,?,?,?,?,?)`,
          sessionId,
          sequence,
          point.latitude,
          point.longitude,
          point.elevationM ?? null,
          point.accuracyM ?? null,
          point.timestampMs,
        );
      }
      await tx.runAsync(
        `UPDATE recording_sessions SET last_sequence=?,accepted_point_count=accepted_point_count+?,distance_m=distance_m+?,updated_at_ms=? WHERE id=? AND owner_user_id=?`,
        sequence,
        points.length,
        distanceDeltaM,
        nowMs,
        sessionId,
        ownerUserId,
      );
    });
    return (await this.getSession(ownerUserId, sessionId))!;
  }
  async setRoutePlan(
    ownerUserId: string,
    sessionId: string,
    route: {
      routeId: string;
      polyline: string;
      waypoints: readonly { latitude: number; longitude: number }[];
    } | null,
  ) {
    await (
      await this.database()
    ).runAsync(
      'UPDATE recording_sessions SET route_id=?,route_polyline=?,route_waypoints_json=?,updated_at_ms=? WHERE id=? AND owner_user_id=?',
      route?.routeId ?? null,
      route?.polyline ?? null,
      route ? JSON.stringify(route.waypoints) : null,
      Date.now(),
      sessionId,
      ownerUserId,
    );
  }
  async saveLocally(
    ownerUserId: string,
    sessionId: string,
    syncJobId: string,
    nowMs: number,
  ) {
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const session = await tx.getFirstAsync<SessionRow>(
        'SELECT * FROM recording_sessions WHERE id=? AND owner_user_id=?',
        sessionId,
        ownerUserId,
      );
      if (!session) throw new Error('Recording not found.');
      if (session.state === 'local_saved') return;
      if (session.state !== 'stopping' && session.state !== 'saving')
        throw new Error('Session must be stopped before local save.');
      if (session.state === 'stopping')
        await tx.runAsync(
          `UPDATE recording_sessions SET state='saving',updated_at_ms=? WHERE id=? AND owner_user_id=?`,
          nowMs,
          sessionId,
          ownerUserId,
        );
      await tx.runAsync(
        `INSERT OR IGNORE INTO sync_jobs (id,entity_id,owner_user_id,state,next_attempt_at_ms,created_at_ms,updated_at_ms) VALUES (?,?,?,'pending',?,?,?)`,
        syncJobId,
        sessionId,
        ownerUserId,
        nowMs,
        nowMs,
        nowMs,
      );
      await tx.runAsync(
        `UPDATE recording_sessions SET state='local_saved',updated_at_ms=? WHERE id=? AND owner_user_id=? AND state='saving'`,
        nowMs,
        sessionId,
        ownerUserId,
      );
    });
    return (await this.getSession(ownerUserId, sessionId))!;
  }
  async discard(ownerUserId: string, sessionId: string) {
    await (
      await this.database()
    ).runAsync(
      'DELETE FROM recording_sessions WHERE id=? AND owner_user_id=?',
      sessionId,
      ownerUserId,
    );
  }
  async hasPendingSync(ownerUserId: string) {
    return (await this.pendingCount(ownerUserId)) > 0;
  }
  async pendingActivityRows(ownerUserId: string) {
    const rows = await (
      await this.database()
    ).getAllAsync<SessionRow & { sync_state: string }>(
      `SELECT recording_sessions.*,sync_jobs.state AS sync_state FROM recording_sessions
       JOIN sync_jobs ON sync_jobs.entity_id=recording_sessions.id
       WHERE recording_sessions.owner_user_id=? AND sync_jobs.state IN ('pending','uploading','needs_attention')
       ORDER BY recording_sessions.started_at_ms DESC LIMIT 200`,
      ownerUserId,
    );
    return rows.map((row) => ({
      id: row.id,
      sport: row.sport,
      title: null,
      started_at: new Date(
        row.started_at_ms ?? row.created_at_ms,
      ).toISOString(),
      stats: {
        distance_m: row.distance_m,
        moving_time_s: Math.max(
          0,
          ((row.stopped_at_ms ?? row.updated_at_ms) -
            (row.started_at_ms ?? row.created_at_ms) -
            row.accumulated_paused_ms) /
            1000,
        ),
        elapsed_time_s: Math.max(
          0,
          ((row.stopped_at_ms ?? row.updated_at_ms) -
            (row.started_at_ms ?? row.created_at_ms)) /
            1000,
        ),
        elevation_gain_m: 0,
        elevation_loss_m: 0,
        average_pace_s_per_km: null,
        average_speed_mps: null,
      },
      pending: true as const,
      syncStatus:
        row.sync_state === 'uploading'
          ? ('uploading' as const)
          : row.sync_state === 'needs_attention'
            ? ('needs_attention' as const)
            : ('waiting_to_upload' as const),
    }));
  }
  async pendingCount(ownerUserId: string) {
    const row = await (
      await this.database()
    ).getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM sync_jobs WHERE owner_user_id=? AND state IN ('pending','uploading','needs_attention')`,
      ownerUserId,
    );
    return row?.count ?? 0;
  }
  async earliestNextAttemptAt(ownerUserId: string) {
    const row = await (
      await this.database()
    ).getFirstAsync<{ next_attempt_at_ms: number }>(
      `SELECT next_attempt_at_ms FROM sync_jobs
       WHERE owner_user_id=? AND state='pending' ORDER BY next_attempt_at_ms LIMIT 1`,
      ownerUserId,
    );
    return row?.next_attempt_at_ms ?? null;
  }
  async recoverInterruptedJobs(ownerUserId: string, nowMs: number) {
    await (
      await this.database()
    ).runAsync(
      `UPDATE sync_jobs SET state='pending',next_attempt_at_ms=?,updated_at_ms=? WHERE owner_user_id=? AND state='uploading'`,
      nowMs,
      nowMs,
      ownerUserId,
    );
  }
  async claimDueJob(
    ownerUserId: string,
    nowMs: number,
  ): Promise<SyncJob | null> {
    const db = await this.database();
    const claimed: SyncJobRow[] = [];
    await db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<SyncJobRow>(
        `SELECT id,entity_id,owner_user_id,attempt_count FROM sync_jobs
         WHERE owner_user_id=? AND state='pending' AND next_attempt_at_ms<=?
         ORDER BY next_attempt_at_ms,created_at_ms LIMIT 1`,
        ownerUserId,
        nowMs,
      );
      if (!row) return;
      const result = await tx.runAsync(
        `UPDATE sync_jobs SET state='uploading',attempt_count=attempt_count+1,updated_at_ms=? WHERE id=? AND owner_user_id=? AND state='pending'`,
        nowMs,
        row.id,
        ownerUserId,
      );
      if (result.changes === 1)
        claimed.push({ ...row, attempt_count: row.attempt_count + 1 });
    });
    const row = claimed[0];
    return row
      ? {
          id: row.id,
          entityId: row.entity_id,
          ownerUserId: row.owner_user_id,
          attemptCount: row.attempt_count,
        }
      : null;
  }
  async activityPayload(
    entityId: string,
    ownerUserId: string,
  ): Promise<CreateActivityRequest> {
    const session = await this.getSession(ownerUserId, entityId);
    if (
      !session ||
      session.state !== 'local_saved' ||
      session.startedAtMs === null ||
      session.stoppedAtMs === null
    )
      throw new Error('Local activity is not ready to upload.');
    const points = await (
      await this.database()
    ).getAllAsync<PointRow>(
      `SELECT sequence,latitude,longitude,elevation_m,accuracy_m,recorded_at_ms
       FROM recording_points WHERE session_id=? ORDER BY sequence`,
      entityId,
    );
    const pauses = await (
      await this.database()
    ).getAllAsync<PauseRow>(
      `SELECT started_at_ms,ended_at_ms FROM recording_pauses
       WHERE session_id=? AND ended_at_ms IS NOT NULL ORDER BY sequence`,
      entityId,
    );
    return {
      payload_version: 1,
      id: session.id,
      sport: session.sport,
      title: null,
      notes: null,
      started_at: new Date(session.startedAtMs).toISOString(),
      ended_at: new Date(session.stoppedAtMs).toISOString(),
      ...recordingRoutePayload(session),
      pauses: pauses.map((pause) => ({
        started_at: new Date(pause.started_at_ms).toISOString(),
        ended_at: new Date(pause.ended_at_ms).toISOString(),
      })),
      points: points.map((point) => ({
        sequence: point.sequence,
        latitude: point.latitude,
        longitude: point.longitude,
        elevation_m: point.elevation_m,
        accuracy_m: point.accuracy_m,
        recorded_at: new Date(point.recorded_at_ms).toISOString(),
      })),
    };
  }
  async completeJob(jobId: string, ownerUserId: string) {
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const job = await tx.getFirstAsync<{ entity_id: string }>(
        `SELECT entity_id FROM sync_jobs WHERE id=? AND owner_user_id=? AND state='uploading'`,
        jobId,
        ownerUserId,
      );
      if (!job) throw new Error('Uploading sync job was not found.');
      await tx.runAsync(
        `DELETE FROM recording_sessions WHERE id=? AND owner_user_id=?`,
        job.entity_id,
        ownerUserId,
      );
    });
  }
  async failJob(
    jobId: string,
    ownerUserId: string,
    failure: SyncFailureKind,
    safeCode: string,
    nextAttemptAtMs: number,
    nowMs: number,
  ) {
    const state =
      failure === 'retryable' || failure === 'auth'
        ? 'pending'
        : 'needs_attention';
    await (
      await this.database()
    ).runAsync(
      `UPDATE sync_jobs SET state=?,last_safe_error_code=?,next_attempt_at_ms=?,updated_at_ms=? WHERE id=? AND owner_user_id=? AND state='uploading'`,
      state,
      safeCode.slice(0, 100),
      nextAttemptAtMs,
      nowMs,
      jobId,
      ownerUserId,
    );
  }
  async retryNeedsAttention(ownerUserId: string, nowMs: number) {
    await (
      await this.database()
    ).runAsync(
      `UPDATE sync_jobs SET state='pending',next_attempt_at_ms=?,last_safe_error_code=NULL,updated_at_ms=? WHERE owner_user_id=? AND state='needs_attention'`,
      nowMs,
      nowMs,
      ownerUserId,
    );
  }
  async getOwnerCleanupMarker(ownerUserId: string) {
    const row = await (
      await this.database()
    ).getFirstAsync<{ state: 'prepared' | 'confirmed' | 'unresolved' }>(
      'SELECT state FROM owner_cleanup_markers WHERE owner_user_id=?',
      ownerUserId,
    );
    return row?.state ?? null;
  }
  async createOwnerCleanupMarker(ownerUserId: string, nowMs: number) {
    await (
      await this.database()
    ).runAsync(
      `INSERT OR IGNORE INTO owner_cleanup_markers (owner_user_id,created_at_ms,state) VALUES (?,?,'prepared')`,
      ownerUserId,
      nowMs,
    );
  }
  async confirmOwnerCleanupMarker(ownerUserId: string) {
    const result = await (
      await this.database()
    ).runAsync(
      `UPDATE owner_cleanup_markers SET state='confirmed' WHERE owner_user_id=? AND state='prepared'`,
      ownerUserId,
    );
    if (result.changes !== 1)
      throw new Error(
        'Cleanup confirmation did not update exactly one prepared marker.',
      );
  }
  async markOwnerCleanupUnresolved(ownerUserId: string) {
    await (
      await this.database()
    ).runAsync(
      `UPDATE owner_cleanup_markers SET state='unresolved' WHERE owner_user_id=?`,
      ownerUserId,
    );
  }
  async cancelOwnerCleanupMarker(ownerUserId: string) {
    await (
      await this.database()
    ).runAsync(
      `DELETE FROM owner_cleanup_markers WHERE owner_user_id=? AND state IN ('prepared','unresolved')`,
      ownerUserId,
    );
  }
  async runPendingOwnerCleanup() {
    const markers = await (
      await this.database()
    ).getAllAsync<{ owner_user_id: string }>(
      `SELECT owner_user_id FROM owner_cleanup_markers WHERE state='confirmed' ORDER BY created_at_ms`,
    );
    for (const marker of markers) await this.purgeOwner(marker.owner_user_id);
  }
  async purgeAbandonedDrafts(nowMs: number) {
    const db = await this.database();
    await db.runAsync(
      `DELETE FROM owner_cleanup_markers WHERE state IN ('prepared','unresolved') AND created_at_ms<?`,
      nowMs - UNRESOLVED_CLEANUP_RETENTION_MS,
    );
    const cutoff = nowMs - ABANDONED_DRAFT_RETENTION_MS;
    const result = await (
      await this.database()
    ).runAsync(
      `DELETE FROM recording_sessions
       WHERE state IN ('starting','paused','stopping','saving') AND updated_at_ms<?
       AND NOT EXISTS (SELECT 1 FROM sync_jobs WHERE entity_id=recording_sessions.id AND state IN ('pending','uploading','needs_attention'))`,
      cutoff,
    );
    return result.changes;
  }
  async addPendingPhoto(input: NewPendingPhoto): Promise<void> {
    await this.migrate();
    const result = await (
      await this.database()
    ).runAsync(
      `INSERT INTO pending_photos (id,owner_user_id,activity_id,local_uri,status,input_mime,input_size_bytes,progress,next_attempt_at_ms,created_at_ms,updated_at_ms)
       SELECT ?,?,?,?,'pending',?,?,0,?,?,? WHERE (SELECT count(*) FROM pending_photos WHERE owner_user_id=? AND activity_id=?) < 10`,
      input.id,
      input.ownerUserId,
      input.activityId,
      input.localUri,
      input.inputMime,
      input.inputSizeBytes,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.ownerUserId,
      input.activityId,
    );
    if (result.changes !== 1) throw new Error('Photo limit reached.');
  }
  async listPendingPhotos(ownerUserId: string, activityId: string) {
    await this.migrate();
    const rows = await (
      await this.database()
    ).getAllAsync<PendingPhotoRow>(
      `SELECT * FROM pending_photos WHERE owner_user_id=? AND activity_id=? ORDER BY created_at_ms,id`,
      ownerUserId,
      activityId,
    );
    return rows.map(mapPendingPhoto);
  }
  async listDuePendingPhotos(ownerUserId: string, nowMs: number) {
    await this.migrate();
    const rows = await (
      await this.database()
    ).getAllAsync<PendingPhotoRow>(
      `SELECT * FROM pending_photos WHERE owner_user_id=? AND status IN ('pending','uploading','completing') AND next_attempt_at_ms<=? AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms<=?) ORDER BY next_attempt_at_ms,id LIMIT 3`,
      ownerUserId,
      nowMs,
      nowMs,
    );
    return rows.map(mapPendingPhoto);
  }
  async listProcessingPendingPhotos(ownerUserId: string) {
    await this.migrate();
    const rows = await (
      await this.database()
    ).getAllAsync<PendingPhotoRow>(
      `SELECT * FROM pending_photos WHERE owner_user_id=? AND status='processing' ORDER BY updated_at_ms,id LIMIT 10`,
      ownerUserId,
    );
    return rows.map(mapPendingPhoto);
  }
  async setPendingPhotoUpload(
    ownerUserId: string,
    id: string,
    serverPhotoId: string,
    progress: number,
    nowMs: number,
  ) {
    await (
      await this.database()
    ).runAsync(
      `UPDATE pending_photos SET server_photo_id=?,status='uploading',progress=?,lease_expires_at_ms=?,updated_at_ms=? WHERE id=? AND owner_user_id=?`,
      serverPhotoId,
      progress,
      nowMs + 120_000,
      nowMs,
      id,
      ownerUserId,
    );
  }
  async setPendingPhotoStatus(
    ownerUserId: string,
    id: string,
    status: PendingPhotoStatus,
    progress: number,
    nowMs: number,
  ) {
    await (
      await this.database()
    ).runAsync(
      `UPDATE pending_photos SET status=?,progress=?,last_safe_error_code=null,lease_expires_at_ms=CASE WHEN ? IN ('uploading','completing') THEN ? ELSE NULL END,updated_at_ms=? WHERE id=? AND owner_user_id=?`,
      status,
      progress,
      status,
      nowMs + 120_000,
      nowMs,
      id,
      ownerUserId,
    );
  }
  async failPendingPhoto(
    ownerUserId: string,
    id: string,
    safeCode: string,
    nextAttemptAtMs: number,
    clearServerPhotoId: boolean,
    nowMs: number,
  ) {
    await (
      await this.database()
    ).runAsync(
      `UPDATE pending_photos SET status=CASE WHEN attempt_count+1>=5 THEN 'needs_attention' WHEN ?=1 THEN 'pending' ELSE 'completing' END,server_photo_id=CASE WHEN ?=1 THEN NULL ELSE server_photo_id END,attempt_count=MIN(5,attempt_count+1),next_attempt_at_ms=?,last_safe_error_code=?,lease_expires_at_ms=NULL,updated_at_ms=? WHERE id=? AND owner_user_id=?`,
      clearServerPhotoId ? 1 : 0,
      clearServerPhotoId ? 1 : 0,
      nextAttemptAtMs,
      safeCode,
      nowMs,
      id,
      ownerUserId,
    );
  }
  async retryPendingPhoto(ownerUserId: string, id: string, nowMs: number) {
    await (
      await this.database()
    ).runAsync(
      `UPDATE pending_photos SET status=CASE WHEN server_photo_id IS NULL THEN 'pending' ELSE 'completing' END,attempt_count=0,next_attempt_at_ms=?,last_safe_error_code=null,lease_expires_at_ms=NULL,updated_at_ms=? WHERE id=? AND owner_user_id=?`,
      nowMs,
      nowMs,
      id,
      ownerUserId,
    );
  }
  async abandonPendingPhotoReservation(
    ownerUserId: string,
    id: string,
    nowMs: number,
  ) {
    await (
      await this.database()
    ).runAsync(
      `UPDATE pending_photos SET server_photo_id=NULL,status='pending',progress=0,next_attempt_at_ms=?,last_safe_error_code='staging_missing',lease_expires_at_ms=NULL,updated_at_ms=? WHERE id=? AND owner_user_id=?`,
      nowMs,
      nowMs,
      id,
      ownerUserId,
    );
  }
  async removePendingPhoto(ownerUserId: string, id: string) {
    await (
      await this.database()
    ).runAsync(
      'DELETE FROM pending_photos WHERE id=? AND owner_user_id=?',
      id,
      ownerUserId,
    );
  }
  async removePendingPhotoByServerId(
    ownerUserId: string,
    serverPhotoId: string,
  ) {
    await (
      await this.database()
    ).runAsync(
      'DELETE FROM pending_photos WHERE server_photo_id=? AND owner_user_id=?',
      serverPhotoId,
      ownerUserId,
    );
  }
  async recoverPendingPhotoLeases(ownerUserId: string, nowMs: number) {
    await this.migrate();
    await (
      await this.database()
    ).runAsync(
      `UPDATE pending_photos SET status=CASE WHEN server_photo_id IS NULL THEN 'pending' ELSE 'completing' END,lease_expires_at_ms=NULL,next_attempt_at_ms=MIN(next_attempt_at_ms,?),updated_at_ms=? WHERE owner_user_id=? AND status IN ('uploading','completing') AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms<=?)`,
      nowMs,
      nowMs,
      ownerUserId,
      nowMs,
    );
  }
  async listRoutes(ownerUserId: string): Promise<readonly CachedRoute[]> {
    await this.migrate();
    const rows = await (
      await this.database()
    ).getAllAsync<CachedRouteRow>(
      'SELECT * FROM cached_routes WHERE owner_user_id=? AND tombstone=0 ORDER BY updated_at DESC,id DESC',
      ownerUserId,
    );
    return rows.map(mapCachedRoute);
  }
  async getRoute(ownerUserId: string, routeId: string) {
    await this.migrate();
    const row = await (
      await this.database()
    ).getFirstAsync<CachedRouteRow>(
      'SELECT * FROM cached_routes WHERE owner_user_id=? AND id=? AND tombstone=0',
      ownerUserId,
      routeId,
    );
    return row ? mapCachedRoute(row) : null;
  }
  async getRouteTombstone(ownerUserId: string, routeId: string) {
    await this.migrate();
    const row = await (
      await this.database()
    ).getFirstAsync<{
      owner_user_id: string;
      id: string;
      revision: number;
      deleted_at_ms: number;
      sync_status: 'synced';
    }>(
      `SELECT owner_user_id,id,revision,deleted_at_ms,sync_status FROM cached_routes WHERE owner_user_id=? AND id=? AND tombstone=1 AND sync_status='synced' AND deleted_at_ms IS NOT NULL`,
      ownerUserId,
      routeId,
    );
    return row
      ? {
          ownerUserId: row.owner_user_id,
          routeId: row.id,
          revision: row.revision,
          deletedAtMs: row.deleted_at_ms,
          status: row.sync_status,
        }
      : null;
  }
  async createRoute(
    ownerUserId: string,
    input: CreateRouteRequest,
    nowMs: number,
  ) {
    await this.migrate();
    const now = new Date(nowMs).toISOString();
    const polyline = encodePolyline(input.waypoints);
    const distanceM = trackDistanceM(input.waypoints);
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        `INSERT INTO cached_routes (owner_user_id,id,name,sport_hint,waypoints_json,polyline,distance_m,elevation_gain_m,created_at,updated_at,sync_status,tombstone,revision,deleted_at_ms)
         VALUES (?,?,?,?,?,?,?,NULL,?,?,'pending',0,1,NULL)`,
        ownerUserId,
        input.id,
        input.name.trim(),
        input.sport_hint ?? null,
        JSON.stringify(input.waypoints),
        polyline,
        distanceM,
        now,
        now,
      );
      await tx.runAsync(
        `INSERT INTO route_sync_jobs (id,owner_user_id,route_id,operation,payload_json,next_attempt_at_ms,status,revision)
         VALUES (?,?,?,'create',?,?,'pending',1)`,
        `${ownerUserId}:${input.id}`,
        ownerUserId,
        input.id,
        JSON.stringify(input),
        nowMs,
      );
    });
    return (await this.getRoute(ownerUserId, input.id))!;
  }
  async updateRoute(
    ownerUserId: string,
    routeId: string,
    patch: UpdateRouteRequest,
    nowMs: number,
  ) {
    await this.migrate();
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<CachedRouteRow>(
        'SELECT * FROM cached_routes WHERE owner_user_id=? AND id=? AND tombstone=0',
        ownerUserId,
        routeId,
      );
      if (!row) throw new Error('route_not_found');
      const current = mapCachedRoute(row);
      const waypoints = patch.waypoints ?? current.waypoints;
      const name = patch.name ?? current.name;
      const sportHint =
        patch.sport_hint === undefined ? current.sport_hint : patch.sport_hint;
      const revision = current.revision + 1;
      const prior = await tx.getFirstAsync<RouteSyncJobRow>(
        'SELECT * FROM route_sync_jobs WHERE owner_user_id=? AND route_id=?',
        ownerUserId,
        routeId,
      );
      const operation = prior?.operation === 'create' ? 'create' : 'update';
      const payload =
        operation === 'create'
          ? { id: routeId, name, sport_hint: sportHint, waypoints }
          : patch;
      await tx.runAsync(
        `UPDATE cached_routes SET name=?,sport_hint=?,waypoints_json=?,polyline=?,distance_m=?,updated_at=?,sync_status='pending',revision=?,deleted_at_ms=NULL WHERE owner_user_id=? AND id=? AND tombstone=0`,
        name,
        sportHint,
        JSON.stringify(waypoints),
        encodePolyline(waypoints),
        trackDistanceM(waypoints),
        new Date(nowMs).toISOString(),
        revision,
        ownerUserId,
        routeId,
      );
      await tx.runAsync(
        `INSERT INTO route_sync_jobs (id,owner_user_id,route_id,operation,payload_json,attempt_count,next_attempt_at_ms,status,revision)
         VALUES (?,?,?,?,?,0,?,'pending',?) ON CONFLICT(owner_user_id,route_id) DO UPDATE SET operation=excluded.operation,payload_json=excluded.payload_json,next_attempt_at_ms=excluded.next_attempt_at_ms,status='pending',revision=excluded.revision`,
        `${ownerUserId}:${routeId}`,
        ownerUserId,
        routeId,
        operation,
        JSON.stringify(payload),
        nowMs,
        revision,
      );
    });
    return (await this.getRoute(ownerUserId, routeId))!;
  }
  async deleteRoute(ownerUserId: string, routeId: string, nowMs: number) {
    await this.migrate();
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<{ revision: number }>(
        'SELECT revision FROM cached_routes WHERE owner_user_id=? AND id=? AND tombstone=0',
        ownerUserId,
        routeId,
      );
      if (!row) throw new Error('route_not_found');
      const revision = row.revision + 1;
      await tx.runAsync(
        `UPDATE cached_routes SET tombstone=1,sync_status='pending',updated_at=?,revision=?,deleted_at_ms=? WHERE owner_user_id=? AND id=? AND tombstone=0`,
        new Date(nowMs).toISOString(),
        revision,
        nowMs,
        ownerUserId,
        routeId,
      );
      await tx.runAsync(
        `INSERT INTO route_sync_jobs (id,owner_user_id,route_id,operation,payload_json,attempt_count,next_attempt_at_ms,status,revision)
         VALUES (?,?,?,'delete',NULL,0,?,'pending',?) ON CONFLICT(owner_user_id,route_id) DO UPDATE SET operation='delete',payload_json=NULL,next_attempt_at_ms=excluded.next_attempt_at_ms,status='pending',revision=excluded.revision`,
        `${ownerUserId}:${routeId}`,
        ownerUserId,
        routeId,
        nowMs,
        revision,
      );
    });
  }
  async mergeRemoteRoutes(ownerUserId: string, routes: readonly Route[]) {
    await this.migrate();
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const route of routes)
        await tx.runAsync(
          `INSERT INTO cached_routes (owner_user_id,id,name,sport_hint,waypoints_json,polyline,distance_m,elevation_gain_m,created_at,updated_at,sync_status,tombstone,revision,deleted_at_ms)
           VALUES (?,?,?,?,?,?,?,?,?,?,'synced',0,0,NULL) ON CONFLICT(owner_user_id,id) DO UPDATE SET name=excluded.name,sport_hint=excluded.sport_hint,waypoints_json=excluded.waypoints_json,polyline=excluded.polyline,distance_m=excluded.distance_m,elevation_gain_m=excluded.elevation_gain_m,created_at=excluded.created_at,updated_at=excluded.updated_at WHERE cached_routes.sync_status='synced' AND cached_routes.tombstone=0`,
          ownerUserId,
          route.id,
          route.name,
          route.sport_hint,
          JSON.stringify(route.waypoints),
          route.polyline,
          route.distance_m,
          route.elevation_gain_m,
          route.created_at,
          route.updated_at,
        );
    });
  }
  async nextRouteSyncJob(ownerUserId: string, nowMs: number) {
    await this.migrate();
    const row = await (
      await this.database()
    ).getFirstAsync<RouteSyncJobRow>(
      `SELECT * FROM route_sync_jobs WHERE owner_user_id=? AND status='pending' AND next_attempt_at_ms<=? ORDER BY next_attempt_at_ms,id LIMIT 1`,
      ownerUserId,
      nowMs,
    );
    return row ? mapRouteSyncJob(row) : null;
  }
  async nextRouteAttemptAt(ownerUserId: string) {
    const row = await (
      await this.database()
    ).getFirstAsync<{ next_attempt_at_ms: number | null }>(
      `SELECT MIN(next_attempt_at_ms) AS next_attempt_at_ms FROM route_sync_jobs WHERE owner_user_id=? AND status='pending'`,
      ownerUserId,
    );
    return row?.next_attempt_at_ms ?? null;
  }
  async completeRouteSyncJob(job: RouteSyncJob, serverRoute?: Route) {
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      if (job.operation === 'create') {
        const currentJob = await tx.getFirstAsync<RouteSyncJobRow>(
          'SELECT * FROM route_sync_jobs WHERE id=? AND owner_user_id=?',
          job.id,
          job.ownerUserId,
        );
        const currentRoute = await tx.getFirstAsync<CachedRouteRow>(
          'SELECT * FROM cached_routes WHERE owner_user_id=? AND id=?',
          job.ownerUserId,
          job.routeId,
        );
        if (
          currentJob?.operation === 'create' &&
          currentJob.revision > job.revision &&
          currentRoute?.revision === currentJob.revision &&
          currentRoute.tombstone === 0
        ) {
          const route = mapCachedRoute(currentRoute);
          await tx.runAsync(
            `UPDATE route_sync_jobs SET operation='update',payload_json=? WHERE id=? AND owner_user_id=? AND revision=? AND operation='create'`,
            JSON.stringify({
              name: route.name,
              sport_hint: route.sport_hint,
              waypoints: route.waypoints,
            }),
            currentJob.id,
            currentJob.owner_user_id,
            currentJob.revision,
          );
          return;
        }
      }
      const deleted = await tx.runAsync(
        'DELETE FROM route_sync_jobs WHERE id=? AND owner_user_id=? AND revision=?',
        job.id,
        job.ownerUserId,
        job.revision,
      );
      if (!deleted.changes) return;
      if (job.operation === 'delete')
        await tx.runAsync(
          `UPDATE cached_routes SET name='',sport_hint=NULL,waypoints_json='[]',polyline='',distance_m=0,elevation_gain_m=NULL,created_at='',updated_at='',sync_status='synced' WHERE owner_user_id=? AND id=? AND tombstone=1 AND revision=?`,
          job.ownerUserId,
          job.routeId,
          job.revision,
        );
      else if (serverRoute)
        await tx.runAsync(
          `UPDATE cached_routes SET name=?,sport_hint=?,waypoints_json=?,polyline=?,distance_m=?,elevation_gain_m=?,created_at=?,updated_at=?,sync_status='synced',tombstone=0,deleted_at_ms=NULL WHERE owner_user_id=? AND id=? AND revision=? AND tombstone=0`,
          serverRoute.name,
          serverRoute.sport_hint,
          JSON.stringify(serverRoute.waypoints),
          serverRoute.polyline,
          serverRoute.distance_m,
          serverRoute.elevation_gain_m,
          serverRoute.created_at,
          serverRoute.updated_at,
          job.ownerUserId,
          job.routeId,
          job.revision,
        );
    });
  }
  async rebaseRouteCreateJob(job: RouteSyncJob) {
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const currentJob = await tx.getFirstAsync<RouteSyncJobRow>(
        `SELECT * FROM route_sync_jobs WHERE id=? AND owner_user_id=? AND revision=? AND operation='create'`,
        job.id,
        job.ownerUserId,
        job.revision,
      );
      const currentRoute = await tx.getFirstAsync<CachedRouteRow>(
        'SELECT * FROM cached_routes WHERE owner_user_id=? AND id=? AND revision=? AND tombstone=0',
        job.ownerUserId,
        job.routeId,
        job.revision,
      );
      if (!currentJob || !currentRoute) return;
      const route = mapCachedRoute(currentRoute);
      await tx.runAsync(
        `UPDATE route_sync_jobs SET operation='update',payload_json=?,status='pending' WHERE id=? AND owner_user_id=? AND revision=? AND operation='create'`,
        JSON.stringify({
          name: route.name,
          sport_hint: route.sport_hint,
          waypoints: route.waypoints,
        }),
        job.id,
        job.ownerUserId,
        job.revision,
      );
    });
  }
  async failRouteSyncJob(
    job: RouteSyncJob,
    nextAttemptAtMs: number,
    needsAttention: boolean,
  ) {
    const status = needsAttention ? 'needs_attention' : 'pending';
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const updated = await tx.runAsync(
        'UPDATE route_sync_jobs SET attempt_count=attempt_count+1,next_attempt_at_ms=?,status=? WHERE id=? AND owner_user_id=? AND revision=?',
        nextAttemptAtMs,
        status,
        job.id,
        job.ownerUserId,
        job.revision,
      );
      if (!updated.changes) return;
      await tx.runAsync(
        'UPDATE cached_routes SET sync_status=? WHERE owner_user_id=? AND id=? AND revision=?',
        status,
        job.ownerUserId,
        job.routeId,
        job.revision,
      );
    });
  }
  async retryRouteSyncJobs(ownerUserId: string, nowMs: number) {
    await (
      await this.database()
    ).runAsync(
      `UPDATE route_sync_jobs SET status='pending',next_attempt_at_ms=? WHERE owner_user_id=? AND status='needs_attention'`,
      nowMs,
      ownerUserId,
    );
    await (
      await this.database()
    ).runAsync(
      `UPDATE cached_routes SET sync_status='pending' WHERE owner_user_id=? AND sync_status='needs_attention'`,
      ownerUserId,
    );
  }
  async purgeExpiredRouteTombstones(ownerUserId: string, nowMs: number) {
    await (
      await this.database()
    ).runAsync(
      `DELETE FROM cached_routes WHERE owner_user_id=? AND tombstone=1 AND sync_status='synced' AND deleted_at_ms IS NOT NULL AND deleted_at_ms<=? AND NOT EXISTS (SELECT 1 FROM route_sync_jobs WHERE route_sync_jobs.owner_user_id=cached_routes.owner_user_id AND route_sync_jobs.route_id=cached_routes.id)`,
      ownerUserId,
      nowMs - ROUTE_TOMBSTONE_RETENTION_MS,
    );
  }
  async purgeOwnerRoutes(ownerUserId: string) {
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        'DELETE FROM route_sync_jobs WHERE owner_user_id=?',
        ownerUserId,
      );
      await tx.runAsync(
        'DELETE FROM cached_routes WHERE owner_user_id=?',
        ownerUserId,
      );
    });
  }
  async purgeOwner(ownerUserId: string) {
    const db = await this.database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        'DELETE FROM pending_photos WHERE owner_user_id=?',
        ownerUserId,
      );
      await tx.runAsync(
        'DELETE FROM recording_sessions WHERE owner_user_id=?',
        ownerUserId,
      );
      await tx.runAsync(
        'DELETE FROM route_sync_jobs WHERE owner_user_id=?',
        ownerUserId,
      );
      await tx.runAsync(
        'DELETE FROM cached_routes WHERE owner_user_id=?',
        ownerUserId,
      );
      await tx.runAsync(
        'DELETE FROM owner_cleanup_markers WHERE owner_user_id=?',
        ownerUserId,
      );
    });
    purgeManagedOwnerPhotos(ownerUserId);
    try {
      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
    } catch {
      // Logical deletion is complete; physical page reclamation is best-effort and retried later.
    }
  }
}

export const recordingRepository = new SQLiteRecordingRepository();
