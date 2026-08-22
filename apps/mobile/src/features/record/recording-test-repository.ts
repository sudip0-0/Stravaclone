import type { TrackPoint } from '@trail/domain';
import { assertTransition } from './recording-state-machine';
import {
  ABANDONED_DRAFT_RETENTION_MS,
  MAX_DISPLAY_POINTS,
  UNRESOLVED_CLEANUP_RETENTION_MS,
  type NewRecordingSession,
  type PersistedRecordingState,
  type RecordingRepository,
  type RecordingSession,
  type SequencedPoint,
} from './recording-types';

export class MemoryRecordingRepository implements RecordingRepository {
  readonly sessions = new Map<string, RecordingSession>();
  readonly points = new Map<string, SequencedPoint[]>();
  readonly pauses = new Map<
    string,
    { startedAtMs: number; endedAtMs: number | null }[]
  >();
  readonly pendingOwners = new Set<string>();
  readonly cleanupMarkers = new Map<
    string,
    'prepared' | 'confirmed' | 'unresolved'
  >();
  readonly cleanupMarkerCreatedAt = new Map<string, number>();
  readonly purgeFailures = new Set<string>();
  readonly confirmFailures = new Set<string>();
  readonly confirmZeroOwners = new Set<string>();
  migrated = false;
  async migrate() {
    this.migrated = true;
  }
  async createRecordingSession(input: NewRecordingSession) {
    if (
      [...this.sessions.values()].some(
        (value) =>
          value.ownerUserId === input.ownerUserId &&
          ['starting', 'recording', 'paused', 'stopping', 'saving'].includes(
            value.state,
          ),
      )
    )
      throw new Error('active session exists');
    const session: RecordingSession = {
      id: input.id,
      ownerUserId: input.ownerUserId,
      sport: input.sport,
      routeId: input.routeId ?? null,
      routePolyline: input.routePolyline ?? null,
      routeWaypoints: input.routeWaypoints ?? [],
      backgroundEnabled: input.backgroundEnabled,
      state: 'recording',
      createdAtMs: input.nowMs,
      updatedAtMs: input.nowMs,
      startedAtMs: input.nowMs,
      stoppedAtMs: null,
      pausedAtMs: null,
      accumulatedPausedMs: 0,
      distanceM: 0,
      acceptedPointCount: 0,
      lastSequence: -1,
      latestRawAccuracyM: null,
      latestRawFixAtMs: null,
      stopReason: null,
      errorCode: null,
    };
    this.sessions.set(session.id, session);
    this.points.set(session.id, []);
    this.pauses.set(session.id, []);
    return session;
  }
  async reconcileOwner(owner: string, nowMs: number) {
    for (const value of this.sessions.values())
      if (value.ownerUserId !== owner && value.state === 'recording') {
        this.sessions.set(value.id, {
          ...value,
          state: 'paused',
          pausedAtMs: nowMs,
          updatedAtMs: nowMs,
        });
        this.pauses
          .get(value.id)
          ?.push({ startedAtMs: nowMs, endedAtMs: null });
      }
    const active = [...this.sessions.values()].find(
      (value) =>
        value.ownerUserId === owner &&
        ['starting', 'recording', 'paused', 'stopping', 'saving'].includes(
          value.state,
        ),
    );
    if (!active) return null;
    if (active.state === 'starting') {
      const fixed = {
        ...active,
        state: 'recording' as const,
        startedAtMs: active.startedAtMs ?? active.createdAtMs,
        updatedAtMs: nowMs,
      };
      this.sessions.set(active.id, fixed);
      return fixed;
    }
    if (active.state === 'saving') {
      const fixed = {
        ...active,
        state: 'local_saved' as const,
        updatedAtMs: nowMs,
      };
      this.sessions.set(active.id, fixed);
      this.pendingOwners.add(owner);
      return null;
    }
    return active;
  }
  async getSession(owner: string, id: string) {
    const value = this.sessions.get(id);
    return value?.ownerUserId === owner ? value : null;
  }
  async getActiveSessionForBackground() {
    const active = [...this.sessions.values()].filter(
      (value) => value.state === 'recording' && value.backgroundEnabled,
    );
    return active.length === 1 ? active[0]! : null;
  }
  async quarantineCollectingSessions(owner: string | null, nowMs: number) {
    for (const value of this.sessions.values())
      if (
        value.state === 'recording' &&
        (owner === null || value.ownerUserId === owner)
      ) {
        this.sessions.set(value.id, {
          ...value,
          state: 'paused',
          pausedAtMs: nowMs,
          updatedAtMs: nowMs,
        });
        this.pauses
          .get(value.id)
          ?.push({ startedAtMs: nowMs, endedAtMs: null });
      }
  }
  async getRecoverableSession(owner: string) {
    return (
      [...this.sessions.values()].find(
        (value) =>
          value.ownerUserId === owner &&
          ['starting', 'recording', 'paused', 'stopping', 'saving'].includes(
            value.state,
          ),
      ) ?? null
    );
  }
  async getLatestSession(owner: string) {
    return (
      [...this.sessions.values()]
        .filter((value) => value.ownerUserId === owner)
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0] ?? null
    );
  }
  async getDisplayPoints(
    owner: string,
    id: string,
    maximum = MAX_DISPLAY_POINTS,
  ) {
    if (!(await this.getSession(owner, id))) return [];
    const values = this.points.get(id) ?? [];
    const cap = Math.max(2, Math.min(MAX_DISPLAY_POINTS, maximum));
    if (values.length <= cap) return values;
    const step = Math.ceil(values.length / (cap - 1));
    const sampled = values.filter(
      (_, index) =>
        index === 0 || index === values.length - 1 || index % step === 0,
    );
    return sampled
      .slice(0, cap - 1)
      .concat(values.at(-1)!)
      .filter(
        (value, index, array) =>
          index === 0 || value.sequence !== array[index - 1]?.sequence,
      );
  }
  async getHudPoints(owner: string, id: string) {
    return (await this.getSession(owner, id))
      ? (this.points.get(id) ?? []).slice(-2)
      : [];
  }
  async getLastPoint(owner: string, id: string) {
    return (await this.getHudPoints(owner, id)).at(-1) ?? null;
  }
  async transition(
    owner: string,
    id: string,
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
    const current = await this.getSession(owner, id);
    if (!current || current.state !== from) throw new Error('stale transition');
    const intervals = this.pauses.get(id) ?? [];
    if (from === 'recording' && to === 'paused')
      intervals.push({ startedAtMs: nowMs, endedAtMs: null });
    if (from === 'paused' && to !== 'paused') {
      const open = [...intervals]
        .reverse()
        .find((pause) => pause.endedAtMs === null);
      if (open) open.endedAtMs = nowMs;
    }
    this.pauses.set(id, intervals);
    const next = { ...current, ...patch, state: to, updatedAtMs: nowMs };
    this.sessions.set(id, next);
    return next;
  }
  async markRecordingError(
    owner: string,
    id: string,
    errorCode: 'task_payload_overflow' | 'persistence_failed',
    nowMs: number,
  ) {
    const current = await this.getSession(owner, id);
    if (current?.state === 'recording')
      this.sessions.set(id, {
        ...current,
        state: 'paused',
        pausedAtMs: current.pausedAtMs ?? nowMs,
        updatedAtMs: nowMs,
        errorCode,
      });
  }
  async recordRawFix(
    owner: string,
    id: string,
    accuracyM: number | null,
    timestampMs: number,
  ) {
    const current = await this.getSession(owner, id);
    if (
      current?.state === 'recording' &&
      (current.latestRawFixAtMs === null ||
        timestampMs > current.latestRawFixAtMs)
    )
      this.sessions.set(id, {
        ...current,
        latestRawAccuracyM: accuracyM,
        latestRawFixAtMs: timestampMs,
      });
  }
  async appendAcceptedPoints(
    owner: string,
    id: string,
    incoming: readonly TrackPoint[],
    distanceDeltaM: number,
    nowMs: number,
  ) {
    const session = await this.getSession(owner, id);
    if (!session || session.state !== 'recording')
      throw new Error('not recording');
    const existing = this.points.get(id) ?? [];
    const appended = incoming.map((point, index) => ({
      ...point,
      sequence: session.lastSequence + index + 1,
    }));
    this.points.set(id, [...existing, ...appended]);
    const next = {
      ...session,
      lastSequence: session.lastSequence + incoming.length,
      acceptedPointCount: session.acceptedPointCount + incoming.length,
      distanceM: session.distanceM + distanceDeltaM,
      updatedAtMs: nowMs,
    };
    this.sessions.set(id, next);
    return next;
  }
  async setRoutePlan(
    owner: string,
    id: string,
    route: {
      routeId: string;
      polyline: string;
      waypoints: readonly { latitude: number; longitude: number }[];
    } | null,
  ) {
    const session = await this.getSession(owner, id);
    if (!session) throw new Error('missing session');
    this.sessions.set(id, {
      ...session,
      routeId: route?.routeId ?? null,
      routePolyline: route?.polyline ?? null,
      routeWaypoints: route?.waypoints ?? [],
    });
  }
  async saveLocally(owner: string, id: string, _job: string, nowMs: number) {
    const session = await this.getSession(owner, id);
    if (!session) throw new Error('missing');
    if (session.state === 'local_saved') return session;
    if (session.state !== 'stopping' && session.state !== 'saving')
      throw new Error('not stopped');
    const next = {
      ...session,
      state: 'local_saved' as const,
      updatedAtMs: nowMs,
    };
    this.sessions.set(id, next);
    this.pendingOwners.add(owner);
    return next;
  }
  async discard(owner: string, id: string) {
    if (await this.getSession(owner, id)) {
      this.sessions.delete(id);
      this.points.delete(id);
      this.pauses.delete(id);
    }
  }
  async hasPendingSync(owner: string) {
    return this.pendingOwners.has(owner);
  }
  async getOwnerCleanupMarker(owner: string) {
    return this.cleanupMarkers.get(owner) ?? null;
  }
  async createOwnerCleanupMarker(owner: string, nowMs: number) {
    if (!this.cleanupMarkers.has(owner)) {
      this.cleanupMarkers.set(owner, 'prepared');
      this.cleanupMarkerCreatedAt.set(owner, nowMs);
    }
  }
  async confirmOwnerCleanupMarker(owner: string) {
    if (this.confirmFailures.has(owner)) throw new Error('confirm failed');
    if (
      this.confirmZeroOwners.has(owner) ||
      this.cleanupMarkers.get(owner) !== 'prepared'
    )
      throw new Error(
        'Cleanup confirmation did not update exactly one prepared marker.',
      );
    this.cleanupMarkers.set(owner, 'confirmed');
  }
  async markOwnerCleanupUnresolved(owner: string) {
    if (this.cleanupMarkers.has(owner))
      this.cleanupMarkers.set(owner, 'unresolved');
  }
  async cancelOwnerCleanupMarker(owner: string) {
    if (this.cleanupMarkers.get(owner) !== 'confirmed') {
      this.cleanupMarkers.delete(owner);
      this.cleanupMarkerCreatedAt.delete(owner);
    }
  }
  async runPendingOwnerCleanup() {
    for (const [owner, state] of [...this.cleanupMarkers])
      if (state === 'confirmed') await this.purgeOwner(owner);
  }
  async purgeAbandonedDrafts(nowMs: number) {
    for (const [owner, state] of [...this.cleanupMarkers])
      if (
        state !== 'confirmed' &&
        (this.cleanupMarkerCreatedAt.get(owner) ?? nowMs) <
          nowMs - UNRESOLVED_CLEANUP_RETENTION_MS
      )
        await this.cancelOwnerCleanupMarker(owner);
    let changes = 0;
    const cutoff = nowMs - ABANDONED_DRAFT_RETENTION_MS;
    for (const value of [...this.sessions.values()])
      if (
        ['starting', 'paused', 'stopping', 'saving'].includes(value.state) &&
        value.updatedAtMs < cutoff &&
        !this.pendingOwners.has(value.ownerUserId)
      ) {
        this.sessions.delete(value.id);
        this.points.delete(value.id);
        this.pauses.delete(value.id);
        changes += 1;
      }
    return changes;
  }
  async purgeOwner(owner: string) {
    if (this.purgeFailures.has(owner)) throw new Error('purge failed');
    for (const value of [...this.sessions.values()])
      if (value.ownerUserId === owner) {
        this.sessions.delete(value.id);
        this.points.delete(value.id);
        this.pauses.delete(value.id);
      }
    this.pendingOwners.delete(owner);
    this.cleanupMarkers.delete(owner);
    this.cleanupMarkerCreatedAt.delete(owner);
  }
}
