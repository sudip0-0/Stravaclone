import { describe, expect, it } from 'vitest';
import { MemoryRecordingRepository } from './recording-test-repository';
import {
  persistLocationBatch,
  RecordingCoordinator,
} from './recording-service';
import { elapsedRecordingMs } from './recording-state-machine';
import {
  MAX_RECORDING_DURATION_MS,
  type RecordingSession,
} from './recording-types';

const OWNER = '11111111-1111-4111-8111-111111111111';
function setup() {
  const repository = new MemoryRecordingRepository();
  const calls: string[] = [];
  const location = {
    start: async (session: RecordingSession) => {
      calls.push(`start:${session.backgroundEnabled}`);
    },
    stop: async () => {
      calls.push('stop');
    },
  };
  const clock = {
    value: 1_000,
    now() {
      return this.value;
    },
  };
  const ids = {
    count: 0,
    create() {
      return `uuid-${++this.count}`;
    },
  };
  return {
    repository,
    calls,
    clock,
    coordinator: new RecordingCoordinator(repository, location, ids, clock),
  };
}

describe('owner-bound durable recording coordinator', () => {
  it('creates a directly recoverable owner row before native start', async () => {
    const { coordinator, repository, calls } = setup();
    const started = await coordinator.start(OWNER, 'run', true);
    expect(started.state).toBe('recording');
    expect((await repository.getRecoverableSession(OWNER))?.id).toBe(
      started.id,
    );
    expect(calls).toEqual(['start:true']);
  });
  it('preserves a recoverable row when native registration fails', async () => {
    const repository = new MemoryRecordingRepository();
    const coordinator = new RecordingCoordinator(
      repository,
      {
        start: async () => {
          throw new Error('native');
        },
        stop: async () => {},
      },
      { create: () => 'stable' },
    );
    await expect(coordinator.start(OWNER, 'run', false)).rejects.toThrow(
      'native',
    );
    expect(await repository.getRecoverableSession(OWNER)).toMatchObject({
      id: 'stable',
      state: 'paused',
    });
  });
  it('pauses immediately and excludes paused points/time', async () => {
    const { coordinator, repository, clock } = setup();
    const started = await coordinator.start(OWNER, 'walk', false);
    clock.value = 5_000;
    const paused = await coordinator.pause(started);
    await persistLocationBatch(
      repository,
      paused,
      [{ latitude: 0, longitude: 0, timestampMs: 6_000 }],
      6_000,
    );
    expect(await repository.getHudPoints(OWNER, paused.id)).toHaveLength(0);
    expect(elapsedRecordingMs(paused, 50_000)).toBe(4_000);
  });
  it('restores only the matching owner after process restart', async () => {
    const { coordinator, repository, clock } = setup();
    const started = await coordinator.start(OWNER, 'ride', true);
    clock.value = 2_000;
    const paused = await coordinator.pause(started);
    const replacement = new RecordingCoordinator(
      repository,
      { start: async () => {}, stop: async () => {} },
      { create: () => 'unused' },
      clock,
    );
    expect(await replacement.initialize('other')).toBeNull();
    expect((await replacement.initialize(OWNER))?.id).toBe(started.id);
    clock.value = 12_000;
    expect((await replacement.resume(paused)).accumulatedPausedMs).toBe(10_000);
  });
  it('repairs every legacy crash window and permits a new start after completed repair', async () => {
    for (const state of ['starting', 'stopping', 'saving'] as const) {
      const repository = new MemoryRecordingRepository();
      const created = await repository.createRecordingSession({
        id: state,
        ownerUserId: OWNER,
        sport: 'run',
        backgroundEnabled: false,
        nowMs: 1,
      });
      repository.sessions.set(state, {
        ...created,
        state,
        startedAtMs: state === 'starting' ? null : 1,
        stoppedAtMs: state === 'starting' ? null : 2,
      });
      const repaired = await repository.reconcileOwner(OWNER, 10);
      if (state === 'starting') expect(repaired?.state).toBe('recording');
      if (state === 'stopping') expect(repaired?.state).toBe('stopping');
      if (state === 'saving') {
        expect(repaired).toBeNull();
        expect(await repository.hasPendingSync(OWNER)).toBe(true);
        await repository.createRecordingSession({
          id: 'next',
          ownerUserId: OWNER,
          sport: 'walk',
          backgroundEnabled: false,
          nowMs: 11,
        });
      }
    }
  });
  it('durably stops before awaiting native shutdown so racing callbacks cannot append', async () => {
    const repository = new MemoryRecordingRepository();
    let stateDuringNativeStop: string | undefined;
    const coordinator = new RecordingCoordinator(
      repository,
      {
        start: async () => {},
        stop: async () => {
          stateDuringNativeStop = (
            await repository.getSession(OWNER, 'ordered')
          )?.state;
        },
      },
      { create: () => 'ordered' },
      { now: () => 31_000 },
    );
    const started = await coordinator.start(OWNER, 'run', true);
    const stopped = await coordinator.stop(started);
    expect(stateDuringNativeStop).toBe('stopping');
    expect(stopped.state).toBe('stopping');
    await persistLocationBatch(
      repository,
      started,
      [{ latitude: 0, longitude: 0, timestampMs: 32_000 }],
      32_000,
    );
    expect(await repository.getHudPoints(OWNER, started.id)).toEqual([]);
  });
  it('makes stop and save idempotent and queues once', async () => {
    const { coordinator, repository, clock } = setup();
    const started = await coordinator.start(OWNER, 'run', true);
    clock.value = 31_000;
    const stopped = await coordinator.stop(started);
    expect(await coordinator.stop(stopped)).toBe(stopped);
    const saved = await coordinator.save(stopped);
    expect((await coordinator.save(saved)).state).toBe('local_saved');
    expect(await repository.hasPendingSync(OWNER)).toBe(true);
  });
  it('auto-stops at duration and point limits without truncating silently', async () => {
    const { coordinator, clock } = setup();
    const started = await coordinator.start(OWNER, 'hike', true);
    clock.value = 1_000 + MAX_RECORDING_DURATION_MS;
    expect((await coordinator.enforceDurationLimit(started)).stopReason).toBe(
      'duration_limit',
    );
    const other = new MemoryRecordingRepository();
    const cap = await other.createRecordingSession({
      id: 'cap',
      ownerUserId: OWNER,
      sport: 'run',
      backgroundEnabled: true,
      nowMs: 1,
    });
    other.sessions.set('cap', {
      ...cap,
      acceptedPointCount: 99_999,
      lastSequence: 99_998,
    });
    const updated = await persistLocationBatch(
      other,
      { ...cap, acceptedPointCount: 99_999, lastSequence: 99_998 },
      [
        { latitude: 0, longitude: 0, timestampMs: 2 },
        { latitude: 0, longitude: 0.000001, timestampMs: 3 },
      ],
      3,
    );
    expect(updated?.stopReason).toBe('point_limit');
    expect(await other.getHudPoints(OWNER, 'cap')).toHaveLength(1);
  });
});
