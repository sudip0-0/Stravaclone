import type { CreateActivityRequest } from '@trail/contracts';
import type { ApiClient } from '../../services/api-client';
import { ApiResponseError } from '../../services/errors';

export type SyncFailureKind = 'retryable' | 'terminal' | 'conflict' | 'auth';
export interface SyncJob {
  readonly id: string;
  readonly entityId: string;
  readonly ownerUserId: string;
  readonly attemptCount: number;
}
export interface SyncRepository {
  recoverInterruptedJobs(ownerUserId: string, nowMs: number): Promise<void>;
  claimDueJob(ownerUserId: string, nowMs: number): Promise<SyncJob | null>;
  activityPayload(
    entityId: string,
    ownerUserId: string,
  ): Promise<CreateActivityRequest>;
  completeJob(jobId: string, ownerUserId: string, nowMs: number): Promise<void>;
  failJob(
    jobId: string,
    ownerUserId: string,
    failure: SyncFailureKind,
    safeCode: string,
    nextAttemptAtMs: number,
    nowMs: number,
  ): Promise<void>;
  retryNeedsAttention(ownerUserId: string, nowMs: number): Promise<void>;
  pendingCount(ownerUserId: string): Promise<number>;
  earliestNextAttemptAt(ownerUserId: string): Promise<number | null>;
}

export function classifySyncFailure(error: unknown): {
  kind: SyncFailureKind;
  code: string;
} {
  if (error instanceof TypeError)
    return { kind: 'retryable', code: 'network_unavailable' };
  if (error instanceof ApiResponseError) {
    if (error.status === 401 || error.status === 403)
      return { kind: 'auth', code: 'authentication_required' };
    if (error.status === 409)
      return { kind: 'conflict', code: 'idempotency_conflict' };
    if (error.status === 408 || error.status === 429 || error.status >= 500)
      return { kind: 'retryable', code: error.code };
    return { kind: 'terminal', code: error.code };
  }
  return { kind: 'retryable', code: 'unknown_commit_state' };
}
export function backoffDelayMs(
  attemptCount: number,
  random = Math.random,
): number {
  const base = Math.min(3_600_000, 2_000 * 2 ** Math.max(0, attemptCount - 1));
  return Math.round(base * (0.75 + random() * 0.5));
}

export class ActivitySyncEngine {
  private flight: Promise<void> | null = null;
  constructor(
    private readonly repository: SyncRepository,
    private readonly api: Pick<ApiClient, 'createActivity'>,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
    private readonly isCurrentOwner: (ownerUserId: string) => boolean = () =>
      true,
  ) {}

  trigger(ownerUserId: string): Promise<void> {
    if (!this.isCurrentOwner(ownerUserId)) return Promise.resolve();
    if (!this.flight) {
      this.flight = this.drain(ownerUserId).finally(() => {
        this.flight = null;
      });
    }
    return this.flight;
  }
  async manualRetry(ownerUserId: string): Promise<void> {
    if (!this.isCurrentOwner(ownerUserId)) return;
    await this.repository.retryNeedsAttention(ownerUserId, this.now());
    await this.trigger(ownerUserId);
  }
  private async drain(ownerUserId: string): Promise<void> {
    await this.repository.recoverInterruptedJobs(ownerUserId, this.now());
    for (;;) {
      if (!this.isCurrentOwner(ownerUserId)) return;
      const job = await this.repository.claimDueJob(ownerUserId, this.now());
      if (!job) return;
      try {
        const payload = await this.repository.activityPayload(
          job.entityId,
          ownerUserId,
        );
        if (!this.isCurrentOwner(ownerUserId)) return;
        await this.api.createActivity(payload);
        if (!this.isCurrentOwner(ownerUserId)) return;
        await this.repository.completeJob(job.id, ownerUserId, this.now());
      } catch (error) {
        const failure = classifySyncFailure(error);
        const delay =
          failure.kind === 'retryable' || failure.kind === 'auth'
            ? backoffDelayMs(job.attemptCount, this.random)
            : 0;
        await this.repository.failJob(
          job.id,
          ownerUserId,
          failure.kind,
          failure.code,
          this.now() + delay,
          this.now(),
        );
        return;
      }
    }
  }
}
