import type { ActivitySport, TrackPoint } from '@trail/domain';

export const MAX_RECORDING_POINTS = 100_000;
export const MAX_RECORDING_DURATION_MS = 12 * 60 * 60 * 1000;
export const MAX_LOCATION_BATCH_SIZE = 120;
export const MAX_DISPLAY_POINTS = 1_000;
export const MIN_DRAFT_RECOVERY_MS = 24 * 60 * 60 * 1_000;
export const ABANDONED_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const UNRESOLVED_CLEANUP_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

export type RecordingState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'saving'
  | 'local_saved';
export type PersistedRecordingState = Exclude<RecordingState, 'idle'>;
export type RecordingErrorCode =
  | 'task_payload_overflow'
  | 'persistence_failed'
  | null;
export type OwnerCleanupState = 'prepared' | 'confirmed' | 'unresolved';
export type RecordingStopReason =
  | 'user'
  | 'duration_limit'
  | 'point_limit'
  | null;

export interface RecordingSession {
  readonly id: string;
  readonly ownerUserId: string;
  readonly state: PersistedRecordingState;
  readonly sport: ActivitySport;
  readonly routeId?: string | null;
  readonly routePolyline?: string | null;
  readonly routeWaypoints?: readonly { latitude: number; longitude: number }[];
  readonly backgroundEnabled: boolean;
  readonly createdAtMs: number;
  readonly startedAtMs: number | null;
  readonly updatedAtMs: number;
  readonly stoppedAtMs: number | null;
  readonly pausedAtMs: number | null;
  readonly accumulatedPausedMs: number;
  readonly distanceM: number;
  readonly acceptedPointCount: number;
  readonly lastSequence: number;
  readonly latestRawAccuracyM: number | null;
  readonly latestRawFixAtMs: number | null;
  readonly stopReason: RecordingStopReason;
  readonly errorCode: RecordingErrorCode;
}

export interface SequencedPoint extends TrackPoint {
  readonly sequence: number;
}

export interface NewRecordingSession {
  readonly id: string;
  readonly ownerUserId: string;
  readonly sport: ActivitySport;
  readonly routeId?: string | null;
  readonly routePolyline?: string | null;
  readonly routeWaypoints?: readonly { latitude: number; longitude: number }[];
  readonly backgroundEnabled: boolean;
  readonly nowMs: number;
}

export interface RecordingRepository {
  migrate(): Promise<void>;
  createRecordingSession(input: NewRecordingSession): Promise<RecordingSession>;
  reconcileOwner(
    ownerUserId: string,
    nowMs: number,
  ): Promise<RecordingSession | null>;
  getSession(ownerUserId: string, id: string): Promise<RecordingSession | null>;
  getActiveSessionForBackground(): Promise<RecordingSession | null>;
  quarantineCollectingSessions(
    ownerUserId: string | null,
    nowMs: number,
  ): Promise<void>;
  getRecoverableSession(ownerUserId: string): Promise<RecordingSession | null>;
  getLatestSession(ownerUserId: string): Promise<RecordingSession | null>;
  getDisplayPoints(
    ownerUserId: string,
    sessionId: string,
    maximum?: number,
  ): Promise<readonly SequencedPoint[]>;
  getHudPoints(
    ownerUserId: string,
    sessionId: string,
  ): Promise<readonly SequencedPoint[]>;
  getLastPoint(
    ownerUserId: string,
    sessionId: string,
  ): Promise<SequencedPoint | null>;
  transition(
    ownerUserId: string,
    sessionId: string,
    from: PersistedRecordingState,
    to: PersistedRecordingState,
    nowMs: number,
    patch?: Partial<
      Pick<
        RecordingSession,
        | 'startedAtMs'
        | 'stoppedAtMs'
        | 'pausedAtMs'
        | 'accumulatedPausedMs'
        | 'stopReason'
        | 'errorCode'
      >
    >,
  ): Promise<RecordingSession>;
  markRecordingError(
    ownerUserId: string,
    sessionId: string,
    errorCode: Exclude<RecordingErrorCode, null>,
    nowMs: number,
  ): Promise<void>;
  recordRawFix(
    ownerUserId: string,
    sessionId: string,
    accuracyM: number | null,
    timestampMs: number,
  ): Promise<void>;
  appendAcceptedPoints(
    ownerUserId: string,
    sessionId: string,
    points: readonly TrackPoint[],
    distanceDeltaM: number,
    nowMs: number,
  ): Promise<RecordingSession>;
  setRoutePlan?(
    ownerUserId: string,
    sessionId: string,
    route: {
      routeId: string;
      polyline: string;
      waypoints: readonly { latitude: number; longitude: number }[];
    } | null,
  ): Promise<void>;
  saveLocally(
    ownerUserId: string,
    sessionId: string,
    syncJobId: string,
    nowMs: number,
  ): Promise<RecordingSession>;
  discard(ownerUserId: string, sessionId: string): Promise<void>;
  hasPendingSync(ownerUserId: string): Promise<boolean>;
  getOwnerCleanupMarker(ownerUserId: string): Promise<OwnerCleanupState | null>;
  createOwnerCleanupMarker(ownerUserId: string, nowMs: number): Promise<void>;
  confirmOwnerCleanupMarker(ownerUserId: string): Promise<void>;
  markOwnerCleanupUnresolved(ownerUserId: string): Promise<void>;
  cancelOwnerCleanupMarker(ownerUserId: string): Promise<void>;
  runPendingOwnerCleanup(): Promise<void>;
  purgeAbandonedDrafts(nowMs: number): Promise<number>;
  purgeOwner(ownerUserId: string): Promise<void>;
}
