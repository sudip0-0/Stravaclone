import { describe, expect, it } from 'vitest';
import { MemoryRecordingRepository } from '../features/record/recording-test-repository';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const create = (repository: MemoryRecordingRepository, id: string, owner = A) =>
  repository.createRecordingSession({
    id,
    ownerUserId: owner,
    sport: 'run',
    backgroundEnabled: true,
    nowMs: 100,
  });

describe('owner-scoped recording repository contract', () => {
  it('persists ordered accepted points and hides every query from another owner', async () => {
    const repository = new MemoryRecordingRepository();
    const session = await create(repository, 'stable');
    await repository.appendAcceptedPoints(
      A,
      session.id,
      [
        { latitude: 1, longitude: 2, timestampMs: 1000 },
        { latitude: 1.00001, longitude: 2, timestampMs: 2000 },
      ],
      1.1,
      2000,
    );
    expect(
      (await repository.getHudPoints(A, session.id)).map(
        (point) => point.sequence,
      ),
    ).toEqual([0, 1]);
    expect(await repository.getSession(B, session.id)).toBeNull();
    expect(await repository.getHudPoints(B, session.id)).toEqual([]);
    expect(await repository.getDisplayPoints(B, session.id)).toEqual([]);
    await repository.discard(B, session.id);
    expect(await repository.getSession(A, session.id)).not.toBeNull();
  });
  it('persists latest raw accuracy independently from accepted points', async () => {
    const repository = new MemoryRecordingRepository();
    const session = await create(repository, 'raw');
    await repository.recordRawFix(A, session.id, 95, 5_000);
    await repository.recordRawFix(A, session.id, 3, 4_000);
    const updated = await repository.getSession(A, session.id);
    expect(updated?.latestRawAccuracyM).toBe(95);
    expect(updated?.latestRawFixAtMs).toBe(5_000);
    expect(updated?.acceptedPointCount).toBe(0);
  });
  it('durably pauses and exposes explicit persistence/task payload errors', async () => {
    const repository = new MemoryRecordingRepository();
    const persistence = await create(repository, 'persistence-error');
    await repository.markRecordingError(
      A,
      persistence.id,
      'persistence_failed',
      10,
    );
    expect(await repository.getSession(A, persistence.id)).toMatchObject({
      state: 'paused',
      errorCode: 'persistence_failed',
    });
    const overflow = await create(repository, 'overflow-error', B);
    await repository.markRecordingError(
      B,
      overflow.id,
      'task_payload_overflow',
      11,
    );
    expect((await repository.getSession(B, overflow.id))?.errorCode).toBe(
      'task_payload_overflow',
    );
  });
  it('bounds display queries to 1000 while preserving source first/last points', async () => {
    const repository = new MemoryRecordingRepository();
    const session = await create(repository, 'long');
    const points = Array.from({ length: 10_000 }, (_, index) => ({
      latitude: 0,
      longitude: index / 1_000_000,
      timestampMs: index + 1,
    }));
    await repository.appendAcceptedPoints(A, session.id, points, 10, 10_001);
    const display = await repository.getDisplayPoints(A, session.id);
    expect(display.length).toBeLessThanOrEqual(1_000);
    expect(display[0]?.sequence).toBe(0);
    expect(display.at(-1)?.sequence).toBe(9_999);
    expect(await repository.getHudPoints(A, session.id)).toHaveLength(2);
  });
  it('purges only the deleted owner including points and pending state', async () => {
    const repository = new MemoryRecordingRepository();
    const a = await create(repository, 'a');
    repository.sessions.set(a.id, {
      ...a,
      state: 'stopping',
      stoppedAtMs: 200,
    });
    await repository.saveLocally(A, a.id, 'sync-a', 200);
    const b = await create(repository, 'b', B);
    repository.sessions.set(b.id, { ...b, state: 'local_saved' });
    await repository.purgeOwner(A);
    expect(await repository.getLatestSession(A)).toBeNull();
    expect(await repository.hasPendingSync(A)).toBe(false);
    expect((await repository.getLatestSession(B))?.id).toBe('b');
  });
  it('allows one active draft per owner without allowing two collectors to be selected', async () => {
    const repository = new MemoryRecordingRepository();
    await create(repository, 'a-active', A);
    await create(repository, 'b-active', B);
    expect(await repository.getActiveSessionForBackground()).toBeNull();
    await repository.quarantineCollectingSessions(A, 5);
    expect(
      (await repository.getActiveSessionForBackground())?.ownerUserId,
    ).toBe(B);
  });
  it('rejects stale/cross-owner transitions', async () => {
    const repository = new MemoryRecordingRepository();
    await create(repository, 's');
    await expect(
      repository.transition(B, 's', 'recording', 'paused', 1),
    ).rejects.toThrow();
    await expect(
      repository.transition(A, 's', 'starting', 'saving', 1),
    ).rejects.toThrow('Invalid recording transition');
  });
});
