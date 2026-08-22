import type {
  CreateRouteRequest,
  Route,
  UpdateRouteRequest,
} from '@trail/contracts';
import type { ApiClient } from '../../services/api-client';
import { ApiResponseError } from '../../services/errors';
import type { CachedRoute, RouteRepository, RouteSyncJob } from './route-cache';

export function routeRetryDelayMs(
  attempt: number,
  random = Math.random,
): number {
  const cap = Math.min(60 * 60_000, 5_000 * 2 ** Math.min(attempt, 10));
  return Math.round(cap / 2 + (random() * cap) / 2);
}
export class RouteSyncEngine {
  private running = new Map<string, Promise<void>>();
  constructor(
    private readonly repository: RouteRepository,
    private readonly api: Pick<
      ApiClient,
      'createRoute' | 'getRoute' | 'updateRoute' | 'deleteRoute'
    >,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
    private readonly isCurrentOwner: (owner: string) => boolean = () => true,
  ) {}
  trigger(owner: string): Promise<void> {
    const existing = this.running.get(owner);
    if (existing) return existing;
    const operation = this.run(owner).finally(() => this.running.delete(owner));
    this.running.set(owner, operation);
    return operation;
  }
  async manualRetry(owner: string): Promise<void> {
    await this.repository.retryRouteSyncJobs(owner, this.now());
    await this.trigger(owner);
  }
  private async run(owner: string) {
    while (this.isCurrentOwner(owner)) {
      const job = await this.repository.nextRouteSyncJob(owner, this.now());
      if (!job) return;
      await this.execute(job);
    }
  }
  private async execute(job: RouteSyncJob) {
    try {
      let route: Route | undefined;
      if (job.operation === 'create')
        route = await this.api.createRoute(job.payload as CreateRouteRequest);
      else if (job.operation === 'update')
        route = await this.api.updateRoute(
          job.routeId,
          job.payload as UpdateRouteRequest,
        );
      else await this.api.deleteRoute(job.routeId);
      await this.repository.completeRouteSyncJob(job, route);
    } catch (error) {
      if (
        job.operation === 'create' &&
        error instanceof ApiResponseError &&
        error.status === 409
      ) {
        try {
          await this.api.getRoute(job.routeId);
          await this.repository.rebaseRouteCreateJob(job);
          return;
        } catch (confirmationError) {
          const terminalConfirmation =
            confirmationError instanceof ApiResponseError &&
            confirmationError.status >= 400 &&
            confirmationError.status < 500 &&
            confirmationError.status !== 408 &&
            confirmationError.status !== 429;
          await this.repository.failRouteSyncJob(
            job,
            this.now() + routeRetryDelayMs(job.attemptCount, this.random),
            terminalConfirmation,
          );
          return;
        }
      }
      if (
        job.operation === 'delete' &&
        error instanceof ApiResponseError &&
        error.status === 404
      ) {
        await this.repository.completeRouteSyncJob(job);
        return;
      }
      const terminal =
        error instanceof ApiResponseError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429;
      await this.repository.failRouteSyncJob(
        job,
        this.now() + routeRetryDelayMs(job.attemptCount, this.random),
        terminal,
      );
    }
  }
}

export class LocalRouteService {
  constructor(
    private readonly repository: RouteRepository,
    private readonly api: Pick<ApiClient, 'listRoutes'>,
    private readonly notifyQueued: () => void,
    private readonly now: () => number = Date.now,
  ) {}
  async list(owner: string): Promise<readonly CachedRoute[]> {
    await this.repository.migrate();
    return this.repository.listRoutes(owner);
  }
  async refresh(owner: string, cursor?: string): Promise<string | null> {
    const page = await this.api.listRoutes(cursor);
    await this.repository.mergeRemoteRoutes(owner, page.items);
    return page.page.next_cursor;
  }
  get(owner: string, id: string) {
    return this.repository.getRoute(owner, id);
  }
  async create(owner: string, input: CreateRouteRequest) {
    const route = await this.repository.createRoute(owner, input, this.now());
    this.notifyQueued();
    return route;
  }
  async update(owner: string, id: string, patch: UpdateRouteRequest) {
    const route = await this.repository.updateRoute(
      owner,
      id,
      patch,
      this.now(),
    );
    this.notifyQueued();
    return route;
  }
  async delete(owner: string, id: string) {
    await this.repository.deleteRoute(owner, id, this.now());
    this.notifyQueued();
  }
}
