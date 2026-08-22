import type { ActivitySport, TrackPoint } from '@trail/domain';
import {
  canSaveRecording,
  elapsedRecordingMs,
} from './recording-state-machine';
import { processLocationBatch } from './location-pipeline';
import {
  MAX_RECORDING_DURATION_MS,
  type RecordingRepository,
  type RecordingSession,
} from './recording-types';

export interface Clock {
  now(): number;
}
export interface LocationCollection {
  start(session: RecordingSession): Promise<void>;
  stop(): Promise<void>;
}
export interface IdFactory {
  create(): string;
}
export const systemClock: Clock = { now: () => Date.now() };
let pipelineQueue: Promise<void> = Promise.resolve();

export async function persistLocationBatch(
  repository: RecordingRepository,
  session: RecordingSession,
  incoming: readonly TrackPoint[],
  nowMs: number,
): Promise<RecordingSession | null> {
  let result: RecordingSession | null = null;
  const run = pipelineQueue.then(async () => {
    const current = await repository.getSession(
      session.ownerUserId,
      session.id,
    );
    if (!current || current.state !== 'recording') return;
    if (elapsedRecordingMs(current, nowMs) >= MAX_RECORDING_DURATION_MS) {
      result = await repository.transition(
        current.ownerUserId,
        current.id,
        'recording',
        'stopping',
        nowMs,
        { stoppedAtMs: nowMs, stopReason: 'duration_limit' },
      );
      return;
    }
    const previous = await repository.getLastPoint(
      current.ownerUserId,
      current.id,
    );
    const processed = processLocationBatch(current, previous, incoming);
    result = await repository.appendAcceptedPoints(
      current.ownerUserId,
      current.id,
      processed.accepted,
      processed.distanceDeltaM,
      nowMs,
    );
    if (processed.pointLimitReached && result.state === 'recording') {
      result = await repository.transition(
        current.ownerUserId,
        current.id,
        'recording',
        'stopping',
        nowMs,
        { stoppedAtMs: nowMs, stopReason: 'point_limit' },
      );
    }
  });
  pipelineQueue = run.catch(() => undefined);
  await run;
  return result;
}

export class RecordingCoordinator {
  constructor(
    private readonly repository: RecordingRepository,
    private readonly location: LocationCollection,
    private readonly ids: IdFactory,
    private readonly clock: Clock = systemClock,
  ) {}

  async initialize(ownerUserId: string): Promise<RecordingSession | null> {
    await this.repository.migrate();
    return this.repository.reconcileOwner(ownerUserId, this.clock.now());
  }
  async start(
    ownerUserId: string,
    sport: ActivitySport,
    backgroundEnabled: boolean,
  ): Promise<RecordingSession> {
    const nowMs = this.clock.now();
    const recording = await this.repository.createRecordingSession({
      id: this.ids.create(),
      ownerUserId,
      sport,
      backgroundEnabled,
      nowMs,
    });
    // Native registration follows the durable row. Failure immediately exposes a resumable paused session.
    try {
      await this.location.start(recording);
      return recording;
    } catch (error) {
      await this.repository.transition(
        ownerUserId,
        recording.id,
        'recording',
        'paused',
        nowMs,
        { pausedAtMs: nowMs },
      );
      throw error;
    }
  }
  async pause(session: RecordingSession): Promise<RecordingSession> {
    if (session.state === 'paused') return session;
    if (session.state !== 'recording')
      throw new Error('Only a recording can pause.');
    const nowMs = this.clock.now();
    const paused = await this.repository.transition(
      session.ownerUserId,
      session.id,
      'recording',
      'paused',
      nowMs,
      { pausedAtMs: nowMs },
    );
    await this.location.stop();
    return paused;
  }
  async resume(session: RecordingSession): Promise<RecordingSession> {
    if (session.state === 'recording') {
      await this.location.start(session);
      return session;
    }
    if (session.state !== 'paused' || session.pausedAtMs === null)
      throw new Error('Only paused recordings can resume.');
    const nowMs = this.clock.now();
    const recording = await this.repository.transition(
      session.ownerUserId,
      session.id,
      'paused',
      'recording',
      nowMs,
      {
        pausedAtMs: null,
        accumulatedPausedMs:
          session.accumulatedPausedMs + Math.max(0, nowMs - session.pausedAtMs),
        errorCode: null,
      },
    );
    try {
      await this.location.start(recording);
      return recording;
    } catch (error) {
      await this.repository.transition(
        session.ownerUserId,
        session.id,
        'recording',
        'paused',
        nowMs,
        { pausedAtMs: nowMs },
      );
      throw error;
    }
  }
  async enforceDurationLimit(
    session: RecordingSession,
  ): Promise<RecordingSession> {
    if (
      session.state === 'recording' &&
      elapsedRecordingMs(session, this.clock.now()) >= MAX_RECORDING_DURATION_MS
    )
      return this.stop(session, 'duration_limit');
    return session;
  }
  async stop(
    session: RecordingSession,
    reason: 'user' | 'duration_limit' | 'point_limit' = 'user',
  ): Promise<RecordingSession> {
    if (
      session.state === 'stopping' ||
      session.state === 'saving' ||
      session.state === 'local_saved'
    )
      return session;
    if (session.state !== 'recording' && session.state !== 'paused')
      throw new Error('Only active sessions can stop.');
    const nowMs = this.clock.now();
    let accumulatedPausedMs = session.accumulatedPausedMs;
    if (session.state === 'paused' && session.pausedAtMs !== null)
      accumulatedPausedMs += Math.max(0, nowMs - session.pausedAtMs);
    const stopping = await this.repository.transition(
      session.ownerUserId,
      session.id,
      session.state,
      'stopping',
      nowMs,
      {
        stoppedAtMs: nowMs,
        pausedAtMs: null,
        accumulatedPausedMs,
        stopReason: reason,
      },
    );
    try {
      await this.location.stop();
    } catch {
      // Durable stopping state prevents further appends; startup retries native shutdown.
    }
    return stopping;
  }
  async save(session: RecordingSession): Promise<RecordingSession> {
    if (session.state === 'local_saved') return session;
    const nowMs = this.clock.now();
    if (session.state !== 'stopping' && session.state !== 'saving')
      throw new Error('Only stopped sessions can save.');
    if (!canSaveRecording(session, nowMs))
      throw new Error(
        'Record for at least 30 seconds or 50 metres before saving.',
      );
    return this.repository.saveLocally(
      session.ownerUserId,
      session.id,
      `sync-${session.id}`,
      nowMs,
    );
  }
  async discard(session: RecordingSession): Promise<void> {
    await this.location.stop();
    await this.repository.discard(session.ownerUserId, session.id);
  }
}
