import type { CreateActivityRequest } from '@trail/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '../../services/errors';
import {
  ActivitySyncEngine,
  backoffDelayMs,
  classifySyncFailure,
  type SyncFailureKind,
  type SyncJob,
  type SyncRepository,
} from './sync-engine';

const payload: CreateActivityRequest = {
  payload_version: 1,
  id: '00000000-0000-4000-8000-000000000001',
  sport: 'run',
  title: null,
  notes: null,
  started_at: '2026-01-01T00:00:00.000Z',
  ended_at: '2026-01-01T00:00:01.000Z',
  route_id: null,
  pauses: [],
  points: [
    {
      sequence: 0,
      latitude: 0,
      longitude: 0,
      elevation_m: null,
      accuracy_m: null,
      recorded_at: '2026-01-01T00:00:00.000Z',
    },
  ],
};
class MemorySyncRepository implements SyncRepository {
  job: SyncJob | null = {
    id: 'job',
    entityId: payload.id,
    ownerUserId: 'owner',
    attemptCount: 0,
  };
  state: 'pending' | 'uploading' | 'synced' | 'needs_attention' = 'pending';
  due = 0;
  lastFailure: { failure: SyncFailureKind; code: string } | null = null;
  recoveries = 0;
  async recoverInterruptedJobs(_owner: string, now: number) {
    this.recoveries += 1;
    if (this.state === 'uploading') {
      this.state = 'pending';
      this.due = now;
    }
  }
  async claimDueJob(_owner: string, now: number) {
    if (!this.job || this.state !== 'pending' || this.due > now) return null;
    this.state = 'uploading';
    this.job = { ...this.job, attemptCount: this.job.attemptCount + 1 };
    return this.job;
  }
  async activityPayload() {
    return payload;
  }
  async completeJob() {
    this.state = 'synced';
  }
  async failJob(
    _id: string,
    _owner: string,
    failure: SyncFailureKind,
    code: string,
    due: number,
  ) {
    this.lastFailure = { failure, code };
    this.due = due;
    this.state =
      failure === 'terminal' || failure === 'conflict'
        ? 'needs_attention'
        : 'pending';
  }
  async retryNeedsAttention(_owner: string, now: number) {
    if (this.state === 'needs_attention') {
      this.state = 'pending';
      this.due = now;
    }
  }
  async pendingCount() {
    return this.state === 'synced' ? 0 : 1;
  }
  async earliestNextAttemptAt() {
    return this.state === 'pending' ? this.due : null;
  }
}
describe('activity sync engine', () => {
  it('keeps airplane-mode failures pending, applies deterministic backoff, and uploads on reconnect', async () => {
    const repository = new MemorySyncRepository();
    let now = 1_000;
    const createActivity = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(payload);
    const engine = new ActivitySyncEngine(
      repository,
      { createActivity },
      () => now,
      () => 0.5,
    );
    await engine.trigger('owner');
    expect(repository.state).toBe('pending');
    expect(repository.due).toBe(now + 2_000);
    now = repository.due;
    await engine.trigger('owner');
    expect(repository.state).toBe('synced');
    expect(createActivity).toHaveBeenCalledTimes(2);
  });
  it('retries timeout-after-commit with the same UUID and does not duplicate local jobs', async () => {
    const repository = new MemorySyncRepository();
    let now = 0;
    const committed = new Set<string>();
    const createActivity = vi.fn(async (request: CreateActivityRequest) => {
      if (!committed.has(request.id)) {
        committed.add(request.id);
        throw new Error('response timeout after commit');
      }
      return request as never;
    });
    const engine = new ActivitySyncEngine(
      repository,
      { createActivity },
      () => now,
      () => 0.5,
    );
    await engine.trigger('owner');
    now = repository.due;
    await engine.trigger('owner');
    expect(committed.size).toBe(1);
    expect(repository.state).toBe('synced');
    expect(createActivity.mock.calls.map(([request]) => request.id)).toEqual([
      payload.id,
      payload.id,
    ]);
  });
  it('recovers an uploading job after restart and allows one in-flight drain', async () => {
    const repository = new MemorySyncRepository();
    repository.state = 'uploading';
    let resolve!: () => void;
    const createActivity = vi.fn(
      () =>
        new Promise<never>((done) => {
          resolve = () => done(payload as never);
        }),
    );
    const engine = new ActivitySyncEngine(
      repository,
      { createActivity },
      () => 0,
      () => 0.5,
    );
    const first = engine.trigger('owner');
    const second = engine.trigger('owner');
    await vi.waitFor(() => expect(createActivity).toHaveBeenCalledTimes(1));
    resolve();
    await Promise.all([first, second]);
    expect(repository.recoveries).toBe(1);
    expect(repository.state).toBe('synced');
  });
  it('does not transmit when owner switches while payload reconstruction is unresolved', async () => {
    const repository = new MemorySyncRepository();
    let currentOwner = 'owner';
    let resolvePayload!: () => void;
    const payloadSpy = vi
      .spyOn(repository, 'activityPayload')
      .mockImplementation(
        () =>
          new Promise<CreateActivityRequest>((resolve) => {
            resolvePayload = () => resolve(payload);
          }),
      );
    const createActivity = vi.fn().mockResolvedValue(payload);
    const engine = new ActivitySyncEngine(
      repository,
      { createActivity },
      () => 0,
      () => 0.5,
      (owner) => owner === currentOwner,
    );
    const flight = engine.trigger('owner');
    await vi.waitFor(() => expect(payloadSpy).toHaveBeenCalled());
    currentOwner = 'other';
    resolvePayload();
    await flight;
    expect(createActivity).not.toHaveBeenCalled();
    expect(repository.state).toBe('uploading');
  });
  it('does not complete an old owner job when the authenticated owner switches in flight', async () => {
    const repository = new MemorySyncRepository();
    let currentOwner = 'owner';
    let resolve!: () => void;
    const createActivity = vi.fn(
      () =>
        new Promise<never>((done) => {
          resolve = () => done(payload as never);
        }),
    );
    const engine = new ActivitySyncEngine(
      repository,
      { createActivity },
      () => 0,
      () => 0.5,
      (owner) => owner === currentOwner,
    );
    const flight = engine.trigger('owner');
    await vi.waitFor(() => expect(createActivity).toHaveBeenCalledOnce());
    currentOwner = 'other';
    resolve();
    await flight;
    expect(repository.state).toBe('uploading');
  });
  it('distinguishes auth retry, terminal validation, and UUID conflict', () => {
    expect(
      classifySyncFailure(new ApiResponseError(401, 'unauthorized')).kind,
    ).toBe('auth');
    expect(
      classifySyncFailure(new ApiResponseError(400, 'invalid_request')).kind,
    ).toBe('terminal');
    expect(
      classifySyncFailure(new ApiResponseError(409, 'idempotency_conflict'))
        .kind,
    ).toBe('conflict');
    expect(
      classifySyncFailure(new ApiResponseError(503, 'service_unavailable'))
        .kind,
    ).toBe('retryable');
    expect(backoffDelayMs(30, () => 1)).toBe(4_500_000);
  });
  it('keeps terminal data for explicit manual retry', async () => {
    const repository = new MemorySyncRepository();
    const createActivity = vi
      .fn()
      .mockRejectedValueOnce(new ApiResponseError(413, 'too_many_points'))
      .mockResolvedValue(payload);
    const engine = new ActivitySyncEngine(
      repository,
      { createActivity },
      () => 0,
      () => 0.5,
    );
    await engine.trigger('owner');
    expect(repository.state).toBe('needs_attention');
    await engine.manualRetry('owner');
    expect(repository.state).toBe('synced');
  });
});
