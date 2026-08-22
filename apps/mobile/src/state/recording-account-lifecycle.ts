import type { RecordingRepository } from '../features/record/recording-types';
import type { ConfirmedCleanupFallbackStore } from '../storage/confirmed-cleanup-fallback';
import type { DraftStateReporter } from './draft-guard';

export type DeletionFailureDisposition = 'definitive' | 'ambiguous';
export function classifyDeletionFailure(
  error: unknown,
): DeletionFailureDisposition {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
  return typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408
    ? 'definitive'
    : 'ambiguous';
}
export class CleanupRequiredError extends Error {
  constructor() {
    super(
      'Server deletion succeeded, but local cleanup authorization could not be made durable. Retry cleanup before leaving this account.',
    );
    this.name = 'CleanupRequiredError';
  }
}
export interface AccountDeletionLifecycle {
  prepareOwnerDeletion(ownerUserId: string): Promise<void>;
  markOwnerDeletionUnresolved(ownerUserId: string): Promise<void>;
  cancelOwnerDeletion(ownerUserId: string): Promise<void>;
  authorizeAndPurgeAfterServerDeletion(ownerUserId: string): Promise<boolean>;
}
export async function executeOwnerDeletion(
  lifecycle: AccountDeletionLifecycle,
  ownerUserId: string,
  serverDelete: () => Promise<void>,
  clearCredentials: () => Promise<void>,
): Promise<void> {
  await lifecycle.prepareOwnerDeletion(ownerUserId);
  try {
    await serverDelete();
  } catch (error) {
    if (classifyDeletionFailure(error) === 'definitive')
      await lifecycle.cancelOwnerDeletion(ownerUserId);
    else await lifecycle.markOwnerDeletionUnresolved(ownerUserId);
    throw error;
  }
  if (!(await lifecycle.authorizeAndPurgeAfterServerDeletion(ownerUserId)))
    throw new CleanupRequiredError();
  await clearCredentials();
}

export class RecordingAccountLifecycleService
  implements AccountDeletionLifecycle
{
  constructor(
    private readonly repository: RecordingRepository,
    private readonly reporter: DraftStateReporter,
    private readonly stopNative: () => Promise<void>,
    private readonly fallback: ConfirmedCleanupFallbackStore,
    private readonly now: () => number = Date.now,
  ) {}
  async runStartupMaintenance(): Promise<void> {
    try {
      await this.repository.migrate();
      await this.repository.quarantineCollectingSessions(null, this.now());
      await this.repository.runPendingOwnerCleanup();
      const fallbackOwner = await this.fallback.read();
      if (fallbackOwner) {
        await this.repository.purgeOwner(fallbackOwner);
        await this.fallback.clear(fallbackOwner);
      }
      await this.repository.purgeAbandonedDrafts(this.now());
    } finally {
      try {
        await this.stopNative();
      } catch {
        /* Retry on the next lifecycle pass. */
      }
    }
  }
  async handleTerminalAuthLoss(ownerUserId: string | null): Promise<void> {
    try {
      await this.repository.migrate();
      await this.repository.quarantineCollectingSessions(
        ownerUserId,
        this.now(),
      );
    } finally {
      try {
        await this.stopNative();
      } catch {
        /* Native stop is always attempted. */
      }
    }
  }
  async prepareOwnerDeletion(ownerUserId: string): Promise<void> {
    const state = await this.reporter.getDraftState(ownerUserId);
    if (state !== 'clear')
      throw new Error(
        'Finish or resolve local activities before deleting this account.',
      );
    const marker = await this.repository.getOwnerCleanupMarker(ownerUserId);
    if (marker)
      throw new Error(
        `Account deletion requires manual resolution (${marker}).`,
      );
    await this.repository.createOwnerCleanupMarker(ownerUserId, this.now());
    await this.stopNative();
  }
  async markOwnerDeletionUnresolved(ownerUserId: string) {
    await this.repository.markOwnerCleanupUnresolved(ownerUserId);
  }
  async cancelOwnerDeletion(ownerUserId: string) {
    await this.repository.cancelOwnerCleanupMarker(ownerUserId);
  }
  async authorizeAndPurgeAfterServerDeletion(
    ownerUserId: string,
  ): Promise<boolean> {
    let durableAuthorization = false;
    try {
      await this.repository.confirmOwnerCleanupMarker(ownerUserId);
      durableAuthorization = true;
    } catch {
      try {
        await this.fallback.write(ownerUserId);
        durableAuthorization = true;
      } catch {
        // Immediate purge remains an independent authorization-preserving path.
      }
    }
    let purged = false;
    try {
      await this.repository.purgeOwner(ownerUserId);
      purged = true;
      try {
        await this.fallback.clear(ownerUserId);
      } catch {
        /* Owner data is already gone. */
      }
    } catch {
      // A durable DB confirmation or fallback marker authorizes startup retry.
    }
    return durableAuthorization || purged;
  }
}
