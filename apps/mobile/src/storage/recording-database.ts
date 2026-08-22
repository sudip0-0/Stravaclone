import * as SQLite from 'expo-sqlite';
import type { CreateActivityRequest } from '@trail/contracts';
import type { TrackPoint } from '@trail/domain';
import type {
  SyncFailureKind,
  SyncJob,
  SyncRepository,
} from '../features/activity-sync/sync-engine';
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

function mapSession(row: SessionRow): RecordingSession {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    state: row.state,
    sport: row.sport,
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

export class PointLimitReachedError extends Error {
  constructor() {
    super('The 100,000-point recording limit was reached.');
  }
}

export class SQLiteRecordingRepository
  implements RecordingRepository, SyncRepository
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
        if (version < 6) await this.runMigration(db, MIGRATION_6);
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
      `INSERT INTO recording_sessions (id,owner_user_id,state,sport,background_enabled,created_at_ms,started_at_ms,updated_at_ms)
       VALUES (?,?,'recording',?,?,?, ?,?)`,
      input.id,
      input.ownerUserId,
      input.sport,
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
      route_id: null,
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
        'DELETE FROM owner_cleanup_markers WHERE owner_user_id=?',
        ownerUserId,
      );
    });
    try {
      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
    } catch {
      // Logical deletion is complete; physical page reclamation is best-effort and retried later.
    }
  }
}

export const recordingRepository = new SQLiteRecordingRepository();
