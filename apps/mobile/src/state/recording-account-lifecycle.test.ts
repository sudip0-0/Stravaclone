import { describe, expect, it, vi } from 'vitest';
import {
  ABANDONED_DRAFT_RETENTION_MS,
  UNRESOLVED_CLEANUP_RETENTION_MS,
} from '../features/record/recording-types';
import { MemoryRecordingRepository } from '../features/record/recording-test-repository';
import {
  CleanupRequiredError,
  executeOwnerDeletion,
  RecordingAccountLifecycleService,
} from './recording-account-lifecycle';
import { RecordingDraftStateReporter } from './recording-draft-reporter';
const A = 'owner-a';
const B = 'owner-b';
class MemoryFallback {
  owner: string | null = null;
  failRead = false;
  failWrite = false;
  failClear = false;
  async read() {
    if (this.failRead) throw new Error('fallback read failed');
    return this.owner;
  }
  async write(owner: string) {
    if (this.failWrite) throw new Error('fallback write failed');
    this.owner = owner;
  }
  async clear(owner: string) {
    if (this.failClear) throw new Error('fallback clear failed');
    if (this.owner === owner) this.owner = null;
  }
}
const lifecycle = (
  repository: MemoryRecordingRepository,
  stop = vi.fn(async () => {}),
  now = () => 100,
  fallback = new MemoryFallback(),
) =>
  new RecordingAccountLifecycleService(
    repository,
    new RecordingDraftStateReporter(repository),
    stop,
    fallback,
    now,
  );
const create = (
  repository: MemoryRecordingRepository,
  id: string,
  owner: string,
  nowMs = 1,
) =>
  repository.createRecordingSession({
    id,
    ownerUserId: owner,
    sport: 'run',
    backgroundEnabled: true,
    nowMs,
  });

describe('auth/account recording lifecycle', () => {
  it('cold terminal auth loss without a loaded profile stops and durably pauses the stored collector', async () => {
    const repository = new MemoryRecordingRepository();
    await create(repository, 'a', A);
    const stop = vi.fn(async () => {});
    await lifecycle(repository, stop).handleTerminalAuthLoss(null);
    expect(stop).toHaveBeenCalledOnce();
    expect((await repository.getRecoverableSession(A))?.state).toBe('paused');
  });
  it('attempts native stop in finally when cold no-profile DB migration fails', async () => {
    const repository = new MemoryRecordingRepository();
    repository.migrate = async () => {
      throw new Error('locked before first unlock');
    };
    const stop = vi.fn(async () => {});
    await expect(
      lifecycle(repository, stop).handleTerminalAuthLoss(null),
    ).rejects.toThrow('locked before first unlock');
    expect(stop).toHaveBeenCalledOnce();
  });
  it('attempts native stop in finally when startup migration fails', async () => {
    const repository = new MemoryRecordingRepository();
    repository.migrate = async () => {
      throw new Error('database unavailable');
    };
    const stop = vi.fn(async () => {});
    await expect(
      lifecycle(repository, stop).runStartupMaintenance(),
    ).rejects.toThrow('database unavailable');
    expect(stop).toHaveBeenCalledOnce();
  });
  it('supports A terminal loss, B recording, then owner-scoped A return', async () => {
    const repository = new MemoryRecordingRepository();
    await create(repository, 'a', A);
    await lifecycle(repository).handleTerminalAuthLoss(A);
    const b = await create(repository, 'b', B);
    expect(b.state).toBe('recording');
    expect((await repository.getRecoverableSession(A))?.id).toBe('a');
    await repository.reconcileOwner(B, 200);
    expect((await repository.getRecoverableSession(A))?.state).toBe('paused');
    expect((await repository.getRecoverableSession(B))?.id).toBe('b');
  });
  it('blocks active and pending deletion before marker, native stop, or server request preparation', async () => {
    const repository = new MemoryRecordingRepository();
    await create(repository, 'a', A);
    const stop = vi.fn(async () => {});
    const service = lifecycle(repository, stop);
    await expect(service.prepareOwnerDeletion(A)).rejects.toThrow(
      'Finish or resolve',
    );
    expect(stop).not.toHaveBeenCalled();
    expect(repository.cleanupMarkers.has(A)).toBe(false);
    await repository.quarantineCollectingSessions(A, 2);
    repository.pendingOwners.add(A);
    await expect(service.prepareOwnerDeletion(A)).rejects.toThrow();
    expect(stop).not.toHaveBeenCalled();
  });
  it('creates marker before request preparation and cancels it on known server failure', async () => {
    const repository = new MemoryRecordingRepository();
    const saved = await create(repository, 'saved', A);
    repository.sessions.set(saved.id, { ...saved, state: 'local_saved' });
    const stop = vi.fn(async () => {});
    const service = lifecycle(repository, stop);
    await service.prepareOwnerDeletion(A);
    expect(repository.cleanupMarkers.get(A)).toBe('prepared');
    expect(stop).toHaveBeenCalledOnce();
    await service.cancelOwnerDeletion(A);
    expect(repository.cleanupMarkers.has(A)).toBe(false);
    expect(await repository.getLatestSession(A)).not.toBeNull();
  });
  it('cancels the marker and retains credentials/data on known server failure', async () => {
    const repository = new MemoryRecordingRepository();
    const saved = await create(repository, 'saved-failure', A);
    repository.sessions.set(saved.id, { ...saved, state: 'local_saved' });
    const clear = vi.fn(async () => {});
    await expect(
      executeOwnerDeletion(
        lifecycle(repository),
        A,
        async () => {
          throw Object.assign(new Error('wrong password'), { status: 401 });
        },
        clear,
      ),
    ).rejects.toThrow('wrong password');
    expect(clear).not.toHaveBeenCalled();
    expect(repository.cleanupMarkers.has(A)).toBe(false);
    expect(await repository.getLatestSession(A)).not.toBeNull();
  });
  it('never lets prepared process-death intent authorize startup purge', async () => {
    const repository = new MemoryRecordingRepository();
    const saved = await create(repository, 'prepared-crash', A);
    repository.sessions.set(saved.id, { ...saved, state: 'local_saved' });
    await repository.createOwnerCleanupMarker(A, 1);
    await lifecycle(repository).runStartupMaintenance();
    expect(repository.cleanupMarkers.get(A)).toBe('prepared');
    expect(await repository.getLatestSession(A)).not.toBeNull();
  });
  it.each([
    new TypeError('network'),
    Object.assign(new Error('timeout'), { status: 408 }),
    Object.assign(new Error('server'), { status: 503 }),
  ])(
    'marks ambiguous deletion failure unresolved and startup preserves data: %s',
    async (failure) => {
      const repository = new MemoryRecordingRepository();
      const saved = await create(repository, `ambiguous-${failure.message}`, A);
      repository.sessions.set(saved.id, { ...saved, state: 'local_saved' });
      const clear = vi.fn(async () => {});
      await expect(
        executeOwnerDeletion(
          lifecycle(repository),
          A,
          async () => {
            throw failure;
          },
          clear,
        ),
      ).rejects.toBe(failure);
      expect(repository.cleanupMarkers.get(A)).toBe('unresolved');
      expect(clear).not.toHaveBeenCalled();
      await lifecycle(repository).runStartupMaintenance();
      expect(await repository.getLatestSession(A)).not.toBeNull();
    },
  );
  it('expires unconfirmed intent after 90 days without deleting owner data', async () => {
    const repository = new MemoryRecordingRepository();
    const saved = await create(repository, 'intent-expiry', A);
    repository.sessions.set(saved.id, { ...saved, state: 'local_saved' });
    await repository.createOwnerCleanupMarker(A, 1);
    await repository.purgeAbandonedDrafts(UNRESOLVED_CLEANUP_RETENTION_MS + 2);
    expect(repository.cleanupMarkers.has(A)).toBe(false);
    expect(await repository.getLatestSession(A)).not.toBeNull();
  });
  it('manual resolution cancels unresolved intent but cannot cancel confirmed cleanup', async () => {
    const repository = new MemoryRecordingRepository();
    await repository.createOwnerCleanupMarker(A, 1);
    await repository.markOwnerCleanupUnresolved(A);
    await lifecycle(repository).cancelOwnerDeletion(A);
    expect(repository.cleanupMarkers.has(A)).toBe(false);
    await repository.createOwnerCleanupMarker(A, 2);
    await repository.confirmOwnerCleanupMarker(A);
    await lifecycle(repository).cancelOwnerDeletion(A);
    expect(repository.cleanupMarkers.get(A)).toBe('confirmed');
  });
  it('retains confirmed marker across purge failure and retries cleanup at startup before another owner', async () => {
    const repository = new MemoryRecordingRepository();
    const a = await create(repository, 'a', A);
    repository.sessions.set(a.id, { ...a, state: 'local_saved' });
    const b = await create(repository, 'b', B);
    repository.sessions.set(b.id, { ...b, state: 'local_saved' });
    await repository.createOwnerCleanupMarker(A, 1);
    await repository.confirmOwnerCleanupMarker(A);
    repository.purgeFailures.add(A);
    await expect(lifecycle(repository).runStartupMaintenance()).rejects.toThrow(
      'purge failed',
    );
    expect(repository.cleanupMarkers.get(A)).toBe('confirmed');
    expect(await repository.getLatestSession(A)).not.toBeNull();
    repository.purgeFailures.delete(A);
    await lifecycle(repository).runStartupMaintenance();
    expect(repository.cleanupMarkers.has(A)).toBe(false);
    expect(await repository.getLatestSession(A)).toBeNull();
    expect((await repository.getLatestSession(B))?.id).toBe('b');
  });
  it('clears credentials after server success even when immediate local purge fails', async () => {
    const repository = new MemoryRecordingRepository();
    const saved = await create(repository, 'saved', A);
    repository.sessions.set(saved.id, { ...saved, state: 'local_saved' });
    repository.purgeFailures.add(A);
    const clear = vi.fn(async () => {});
    const server = vi.fn(async () => {});
    await executeOwnerDeletion(lifecycle(repository), A, server, clear);
    expect(server).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(repository.cleanupMarkers.get(A)).toBe('confirmed');
  });
  it('uses secure fallback when DB confirmation updates zero rows and retries purge after restart', async () => {
    const repository = new MemoryRecordingRepository();
    const saved = await create(repository, 'zero-confirm', A);
    repository.sessions.set(saved.id, { ...saved, state: 'local_saved' });
    repository.confirmZeroOwners.add(A);
    repository.purgeFailures.add(A);
    const fallback = new MemoryFallback();
    const clear = vi.fn(async () => {});
    await executeOwnerDeletion(
      lifecycle(repository, undefined, undefined, fallback),
      A,
      async () => {},
      clear,
    );
    expect(clear).toHaveBeenCalledOnce();
    expect(fallback.owner).toBe(A);
    expect(repository.cleanupMarkers.get(A)).toBe('prepared');
    repository.purgeFailures.delete(A);
    await lifecycle(
      repository,
      undefined,
      undefined,
      fallback,
    ).runStartupMaintenance();
    expect(await repository.getLatestSession(A)).toBeNull();
    expect(fallback.owner).toBeNull();
  });
  it('uses secure fallback after DB confirmation exception', async () => {
    const repository = new MemoryRecordingRepository();
    const saved = await create(repository, 'confirm-exception', A);
    repository.sessions.set(saved.id, { ...saved, state: 'local_saved' });
    repository.confirmFailures.add(A);
    repository.purgeFailures.add(A);
    const fallback = new MemoryFallback();
    expect(
      await lifecycle(
        repository,
        undefined,
        undefined,
        fallback,
      ).authorizeAndPurgeAfterServerDeletion(A),
    ).toBe(true);
    expect(fallback.owner).toBe(A);
  });
  it('allows successful immediate purge when both durable confirmation writes fail', async () => {
    const repository = new MemoryRecordingRepository();
    const saved = await create(repository, 'immediate-purge', A);
    repository.sessions.set(saved.id, { ...saved, state: 'local_saved' });
    repository.confirmFailures.add(A);
    const fallback = new MemoryFallback();
    fallback.failWrite = true;
    const clear = vi.fn(async () => {});
    await executeOwnerDeletion(
      lifecycle(repository, undefined, undefined, fallback),
      A,
      async () => {},
      clear,
    );
    expect(clear).toHaveBeenCalledOnce();
    expect(await repository.getLatestSession(A)).toBeNull();
    expect(fallback.owner).toBeNull();
  });
  it('enters cleanup-required semantics and retains credentials when confirmation, fallback, and purge all fail', async () => {
    const repository = new MemoryRecordingRepository();
    const saved = await create(repository, 'all-fail', A);
    repository.sessions.set(saved.id, { ...saved, state: 'local_saved' });
    repository.confirmFailures.add(A);
    repository.purgeFailures.add(A);
    const fallback = new MemoryFallback();
    fallback.failWrite = true;
    const clear = vi.fn(async () => {});
    await expect(
      executeOwnerDeletion(
        lifecycle(repository, undefined, undefined, fallback),
        A,
        async () => {},
        clear,
      ),
    ).rejects.toBeInstanceOf(CleanupRequiredError);
    expect(clear).not.toHaveBeenCalled();
    expect(await repository.getLatestSession(A)).not.toBeNull();
    expect(repository.cleanupMarkers.get(A)).toBe('prepared');
    fallback.failWrite = false;
    expect(
      await lifecycle(
        repository,
        undefined,
        undefined,
        fallback,
      ).authorizeAndPurgeAfterServerDeletion(A),
    ).toBe(true);
    expect(fallback.owner).toBe(A);
  });
  it('purges abandoned non-pending drafts only after 30 days and retains pending uploads', async () => {
    const repository = new MemoryRecordingRepository();
    const old = await create(repository, 'old', A, 1);
    repository.sessions.set(old.id, {
      ...old,
      state: 'paused',
      updatedAtMs: 1,
    });
    expect(
      await repository.purgeAbandonedDrafts(ABANDONED_DRAFT_RETENTION_MS),
    ).toBe(0);
    expect(
      await repository.purgeAbandonedDrafts(ABANDONED_DRAFT_RETENTION_MS + 2),
    ).toBe(1);
    const pending = await create(repository, 'pending', A, 1);
    repository.sessions.set(pending.id, {
      ...pending,
      state: 'paused',
      updatedAtMs: 1,
    });
    repository.pendingOwners.add(A);
    expect(
      await repository.purgeAbandonedDrafts(ABANDONED_DRAFT_RETENTION_MS + 2),
    ).toBe(0);
  });
});
