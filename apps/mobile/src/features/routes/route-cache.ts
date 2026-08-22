import type {
  CreateRouteRequest,
  Route,
  UpdateRouteRequest,
} from '@trail/contracts';
import { encodePolyline, trackDistanceM } from '@trail/domain';

export type RouteSyncStatus = 'synced' | 'pending' | 'needs_attention';
export type RouteMutationOperation = 'create' | 'update' | 'delete';
export const ROUTE_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export interface CachedRoute extends Route {
  readonly owner_user_id: string;
  readonly sync_status: RouteSyncStatus;
  readonly revision: number;
}
export interface RouteTombstone {
  readonly ownerUserId: string;
  readonly routeId: string;
  readonly revision: number;
  readonly deletedAtMs: number;
  readonly status: 'synced';
}
export interface RouteSyncJob {
  readonly id: string;
  readonly ownerUserId: string;
  readonly routeId: string;
  readonly operation: RouteMutationOperation;
  readonly payload: CreateRouteRequest | UpdateRouteRequest | null;
  readonly attemptCount: number;
  readonly nextAttemptAtMs: number;
  readonly status: Exclude<RouteSyncStatus, 'synced'>;
  readonly revision: number;
}
export interface RouteRepository {
  migrate(): Promise<void>;
  listRoutes(ownerUserId: string): Promise<readonly CachedRoute[]>;
  getRoute(ownerUserId: string, routeId: string): Promise<CachedRoute | null>;
  getRouteTombstone(
    ownerUserId: string,
    routeId: string,
  ): Promise<RouteTombstone | null>;
  createRoute(
    ownerUserId: string,
    input: CreateRouteRequest,
    nowMs: number,
  ): Promise<CachedRoute>;
  updateRoute(
    ownerUserId: string,
    routeId: string,
    patch: UpdateRouteRequest,
    nowMs: number,
  ): Promise<CachedRoute>;
  deleteRoute(
    ownerUserId: string,
    routeId: string,
    nowMs: number,
  ): Promise<void>;
  mergeRemoteRoutes(
    ownerUserId: string,
    routes: readonly Route[],
  ): Promise<void>;
  nextRouteSyncJob(
    ownerUserId: string,
    nowMs: number,
  ): Promise<RouteSyncJob | null>;
  nextRouteAttemptAt(ownerUserId: string): Promise<number | null>;
  completeRouteSyncJob(job: RouteSyncJob, serverRoute?: Route): Promise<void>;
  rebaseRouteCreateJob(job: RouteSyncJob): Promise<void>;
  failRouteSyncJob(
    job: RouteSyncJob,
    nextAttemptAtMs: number,
    needsAttention: boolean,
  ): Promise<void>;
  retryRouteSyncJobs(ownerUserId: string, nowMs: number): Promise<void>;
  purgeExpiredRouteTombstones(
    ownerUserId: string,
    nowMs: number,
  ): Promise<void>;
  purgeOwnerRoutes(ownerUserId: string): Promise<void>;
}

export function localRoute(
  ownerUserId: string,
  input: CreateRouteRequest,
  nowMs: number,
): CachedRoute {
  const iso = new Date(nowMs).toISOString();
  return {
    id: input.id,
    owner_user_id: ownerUserId,
    name: input.name.trim(),
    sport_hint: input.sport_hint ?? null,
    waypoints: input.waypoints,
    polyline: encodePolyline(input.waypoints),
    distance_m: trackDistanceM(input.waypoints),
    elevation_gain_m: null,
    created_at: iso,
    updated_at: iso,
    sync_status: 'pending',
    revision: 1,
  };
}

interface MemoryState {
  routes: Map<
    string,
    CachedRoute & { tombstone: boolean; deletedAtMs: number | null }
  >;
  jobs: Map<string, RouteSyncJob>;
}
export class MemoryRouteRepository implements RouteRepository {
  constructor(
    private readonly state: MemoryState = {
      routes: new Map(),
      jobs: new Map(),
    },
  ) {}
  reopen(): MemoryRouteRepository {
    return new MemoryRouteRepository(this.state);
  }
  async migrate() {}
  private key(owner: string, id: string) {
    return `${owner}:${id}`;
  }
  async listRoutes(owner: string) {
    return [...this.state.routes.values()]
      .filter((route) => route.owner_user_id === owner && !route.tombstone)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async getRoute(owner: string, id: string) {
    const route = this.state.routes.get(this.key(owner, id));
    return route && !route.tombstone ? route : null;
  }
  async getRouteTombstone(owner: string, id: string) {
    const route = this.state.routes.get(this.key(owner, id));
    return route?.tombstone &&
      route.sync_status === 'synced' &&
      route.deletedAtMs !== null
      ? {
          ownerUserId: owner,
          routeId: id,
          revision: route.revision,
          deletedAtMs: route.deletedAtMs,
          status: 'synced' as const,
        }
      : null;
  }
  async createRoute(owner: string, input: CreateRouteRequest, now: number) {
    const route = {
      ...localRoute(owner, input, now),
      tombstone: false,
      deletedAtMs: null,
    };
    this.state.routes.set(this.key(owner, input.id), route);
    this.state.jobs.set(this.key(owner, input.id), {
      id: input.id,
      ownerUserId: owner,
      routeId: input.id,
      operation: 'create',
      payload: input,
      attemptCount: 0,
      nextAttemptAtMs: now,
      status: 'pending',
      revision: route.revision,
    });
    return route;
  }
  async updateRoute(
    owner: string,
    id: string,
    patch: UpdateRouteRequest,
    now: number,
  ) {
    const stored = this.state.routes.get(this.key(owner, id));
    const current = stored && !stored.tombstone ? stored : null;
    if (!current) throw new Error('route_not_found');
    const waypoints = patch.waypoints ?? current.waypoints;
    const route = {
      ...current,
      name: patch.name ?? current.name,
      sport_hint:
        patch.sport_hint === undefined ? current.sport_hint : patch.sport_hint,
      waypoints,
      polyline: encodePolyline(waypoints),
      distance_m: trackDistanceM(waypoints),
      updated_at: new Date(now).toISOString(),
      sync_status: 'pending' as const,
      revision: current.revision + 1,
      tombstone: false,
      deletedAtMs: null,
    };
    this.state.routes.set(this.key(owner, id), route);
    const prior = this.state.jobs.get(this.key(owner, id));
    const operation = prior?.operation === 'create' ? 'create' : 'update';
    const payload =
      operation === 'create'
        ? {
            id,
            name: route.name,
            sport_hint: route.sport_hint,
            waypoints: route.waypoints,
          }
        : patch;
    this.state.jobs.set(this.key(owner, id), {
      id,
      ownerUserId: owner,
      routeId: id,
      operation,
      payload,
      attemptCount: prior?.attemptCount ?? 0,
      nextAttemptAtMs: now,
      status: 'pending',
      revision: route.revision,
    });
    return route;
  }
  async deleteRoute(owner: string, id: string, now: number) {
    const stored = this.state.routes.get(this.key(owner, id));
    const current = stored && !stored.tombstone ? stored : null;
    if (!current) throw new Error('route_not_found');
    const revision = current.revision + 1;
    this.state.routes.set(this.key(owner, id), {
      ...current,
      sync_status: 'pending',
      revision,
      tombstone: true,
      deletedAtMs: now,
    });
    const prior = this.state.jobs.get(this.key(owner, id));
    this.state.jobs.set(this.key(owner, id), {
      id,
      ownerUserId: owner,
      routeId: id,
      operation: 'delete',
      payload: null,
      attemptCount: prior?.attemptCount ?? 0,
      nextAttemptAtMs: now,
      status: 'pending',
      revision,
    });
  }
  async mergeRemoteRoutes(owner: string, routes: readonly Route[]) {
    for (const route of routes) {
      const key = this.key(owner, route.id);
      const local = this.state.routes.get(key);
      if (!local || (!local.tombstone && local.sync_status === 'synced'))
        this.state.routes.set(key, {
          ...route,
          owner_user_id: owner,
          sync_status: 'synced',
          revision: local?.revision ?? 0,
          tombstone: false,
          deletedAtMs: null,
        });
    }
  }
  async nextRouteSyncJob(owner: string, now: number) {
    return (
      [...this.state.jobs.values()].find(
        (job) =>
          job.ownerUserId === owner &&
          job.status === 'pending' &&
          job.nextAttemptAtMs <= now,
      ) ?? null
    );
  }
  async nextRouteAttemptAt(owner: string) {
    const values = [...this.state.jobs.values()]
      .filter((job) => job.ownerUserId === owner && job.status === 'pending')
      .map((job) => job.nextAttemptAtMs);
    return values.length ? Math.min(...values) : null;
  }
  async completeRouteSyncJob(job: RouteSyncJob, serverRoute?: Route) {
    const key = this.key(job.ownerUserId, job.routeId);
    const currentJob = this.state.jobs.get(key);
    const current = this.state.routes.get(key);
    if (
      currentJob?.revision !== job.revision ||
      current?.revision !== job.revision
    ) {
      if (
        job.operation === 'create' &&
        currentJob?.operation === 'create' &&
        currentJob.revision > job.revision &&
        current?.revision === currentJob.revision &&
        !current.tombstone
      )
        this.state.jobs.set(key, {
          ...currentJob,
          operation: 'update',
          payload: {
            name: current.name,
            sport_hint: current.sport_hint,
            waypoints: current.waypoints,
          },
        });
      return;
    }
    this.state.jobs.delete(key);
    if (job.operation === 'delete')
      this.state.routes.set(key, {
        id: current.id,
        owner_user_id: current.owner_user_id,
        name: '',
        sport_hint: null,
        waypoints: [],
        polyline: '',
        distance_m: 0,
        elevation_gain_m: null,
        created_at: '',
        updated_at: '',
        sync_status: 'synced',
        revision: current.revision,
        tombstone: true,
        deletedAtMs: current.deletedAtMs,
      });
    else
      this.state.routes.set(key, {
        ...(serverRoute ?? current),
        owner_user_id: job.ownerUserId,
        sync_status: 'synced',
        revision: job.revision,
        tombstone: false,
        deletedAtMs: null,
      });
  }
  async rebaseRouteCreateJob(job: RouteSyncJob) {
    const key = this.key(job.ownerUserId, job.routeId);
    const currentJob = this.state.jobs.get(key);
    const current = this.state.routes.get(key);
    if (
      currentJob?.operation !== 'create' ||
      currentJob.revision !== job.revision ||
      current?.revision !== job.revision ||
      current.tombstone
    )
      return;
    this.state.jobs.set(key, {
      ...currentJob,
      operation: 'update',
      payload: {
        name: current.name,
        sport_hint: current.sport_hint,
        waypoints: current.waypoints,
      },
      status: 'pending',
    });
  }
  async failRouteSyncJob(job: RouteSyncJob, next: number, needs: boolean) {
    const key = this.key(job.ownerUserId, job.routeId);
    const currentJob = this.state.jobs.get(key);
    const route = this.state.routes.get(key);
    if (
      currentJob?.revision !== job.revision ||
      route?.revision !== job.revision
    )
      return;
    this.state.jobs.set(key, {
      ...currentJob,
      attemptCount: currentJob.attemptCount + 1,
      nextAttemptAtMs: next,
      status: needs ? 'needs_attention' : 'pending',
    });
    this.state.routes.set(key, {
      ...route,
      sync_status: needs ? 'needs_attention' : 'pending',
    });
  }
  async retryRouteSyncJobs(owner: string, now: number) {
    for (const [key, job] of this.state.jobs)
      if (job.ownerUserId === owner && job.status === 'needs_attention')
        this.state.jobs.set(key, {
          ...job,
          status: 'pending',
          nextAttemptAtMs: now,
        });
  }
  async purgeExpiredRouteTombstones(owner: string, now: number) {
    for (const [key, route] of this.state.routes)
      if (
        route.owner_user_id === owner &&
        route.tombstone &&
        route.sync_status === 'synced' &&
        route.deletedAtMs !== null &&
        route.deletedAtMs <= now - ROUTE_TOMBSTONE_RETENTION_MS &&
        !this.state.jobs.has(key)
      )
        this.state.routes.delete(key);
  }
  async purgeOwnerRoutes(owner: string) {
    for (const [key, route] of this.state.routes)
      if (route.owner_user_id === owner) this.state.routes.delete(key);
    for (const [key, job] of this.state.jobs)
      if (job.ownerUserId === owner) this.state.jobs.delete(key);
  }
}
