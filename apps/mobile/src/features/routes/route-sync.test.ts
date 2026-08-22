import type {
  CreateRouteRequest,
  Route,
  UpdateRouteRequest,
} from '@trail/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '../../services/errors';
import {
  MemoryRouteRepository,
  ROUTE_TOMBSTONE_RETENTION_MS,
} from './route-cache';
import { LocalRouteService, RouteSyncEngine } from './route-sync';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const input: CreateRouteRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Offline route',
  sport_hint: 'run',
  waypoints: [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0.001 },
  ],
};
function serverRoute(request: CreateRouteRequest): Route {
  return {
    id: request.id,
    name: request.name,
    sport_hint: request.sport_hint ?? null,
    waypoints: request.waypoints,
    polyline: 'encoded',
    distance_m: 111,
    elevation_gain_m: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('durable owner route cache and sync', () => {
  it('saves offline, reopens from durable state, then syncs after reconnect', async () => {
    const repository = new MemoryRouteRepository();
    const notify = vi.fn();
    const service = new LocalRouteService(
      repository,
      {
        listRoutes: async () => {
          throw new Error('offline');
        },
      },
      notify,
      () => 100,
    );
    const cached = await service.create(owner, input);
    expect(cached.sync_status).toBe('pending');
    expect(notify).toHaveBeenCalledOnce();
    const reopened = repository.reopen();
    expect((await reopened.getRoute(owner, input.id))?.name).toBe(
      'Offline route',
    );
    expect(await reopened.getRoute(other, input.id)).toBeNull();
    const createRoute = vi.fn(async (request: CreateRouteRequest) =>
      serverRoute(request),
    );
    await new RouteSyncEngine(
      reopened,
      {
        createRoute,
        getRoute: vi.fn(async () => serverRoute(input)),
        updateRoute: vi.fn(),
        deleteRoute: vi.fn(),
      },
      () => 100,
    ).trigger(owner);
    expect((await reopened.getRoute(owner, input.id))?.sync_status).toBe(
      'synced',
    );
    expect(createRoute).toHaveBeenCalledOnce();
  });
  it('applies update and tombstoned delete locally before server confirmation', async () => {
    const repository = new MemoryRouteRepository();
    await repository.createRoute(owner, input, 1);
    await repository.completeRouteSyncJob(
      (await repository.nextRouteSyncJob(owner, 1))!,
      serverRoute(input),
    );
    const updated = await repository.updateRoute(
      owner,
      input.id,
      { name: 'Changed' },
      2,
    );
    expect(updated.name).toBe('Changed');
    expect(updated.sync_status).toBe('pending');
    const updateRoute = vi.fn(async () => ({
      ...serverRoute(input),
      name: 'Changed',
    }));
    await new RouteSyncEngine(
      repository,
      {
        createRoute: vi.fn(),
        getRoute: vi.fn(async () => serverRoute(input)),
        updateRoute,
        deleteRoute: vi.fn(),
      },
      () => 2,
    ).trigger(owner);
    expect(updateRoute).toHaveBeenCalledWith(input.id, { name: 'Changed' });
    expect((await repository.getRoute(owner, input.id))?.sync_status).toBe(
      'synced',
    );
    await repository.deleteRoute(owner, input.id, 3);
    expect(await repository.getRoute(owner, input.id)).toBeNull();
    expect(await repository.listRoutes(owner)).toEqual([]);
    await repository.mergeRemoteRoutes(owner, [serverRoute(input)]);
    expect(await repository.getRoute(owner, input.id)).toBeNull();
    const deleteRoute = vi.fn(async () => undefined);
    await new RouteSyncEngine(
      repository,
      {
        createRoute: vi.fn(),
        getRoute: vi.fn(async () => serverRoute(input)),
        updateRoute: vi.fn(),
        deleteRoute,
      },
      () => 3,
    ).trigger(owner);
    expect(deleteRoute).toHaveBeenCalledWith(input.id);
    expect(await repository.getRoute(owner, input.id)).toBeNull();
  });
  it('retries timeout-after-commit idempotently without duplicating the cached route', async () => {
    const repository = new MemoryRouteRepository();
    await repository.createRoute(owner, input, 0);
    let committed = false;
    const createRoute = vi.fn(async (request: CreateRouteRequest) => {
      if (!committed) {
        committed = true;
        throw new Error('timeout after commit');
      }
      return serverRoute(request);
    });
    let now = 0;
    const engine = new RouteSyncEngine(
      repository,
      {
        createRoute,
        getRoute: vi.fn(async () => serverRoute(input)),
        updateRoute: vi.fn(),
        deleteRoute: vi.fn(),
      },
      () => now,
      () => 0,
    );
    await engine.trigger(owner);
    expect((await repository.getRoute(owner, input.id))?.sync_status).toBe(
      'pending',
    );
    now = 5_000;
    await engine.trigger(owner);
    expect(createRoute).toHaveBeenCalledTimes(2);
    expect(await repository.listRoutes(owner)).toHaveLength(1);
    expect((await repository.getRoute(owner, input.id))?.sync_status).toBe(
      'synced',
    );
  });
  it('rebases a newer local create revision to PATCH after the older create succeeds', async () => {
    const repository = new MemoryRouteRepository();
    await repository.createRoute(owner, input, 0);
    let resolveCreate!: (route: Route) => void;
    const createRoute = vi.fn(
      () =>
        new Promise<Route>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    let server = serverRoute(input);
    const updateRoute = vi.fn(
      async (_id: string, patch: UpdateRouteRequest) => {
        server = { ...server, name: patch.name ?? server.name };
        return server;
      },
    );
    const engine = new RouteSyncEngine(repository, {
      createRoute,
      getRoute: vi.fn(async () => server),
      updateRoute,
      deleteRoute: vi.fn(),
    });
    const drain = engine.trigger(owner);
    await vi.waitFor(() => expect(createRoute).toHaveBeenCalledOnce());
    await repository.updateRoute(owner, input.id, { name: 'Latest B' }, 1);
    resolveCreate(serverRoute(input));
    await drain;
    expect(updateRoute).toHaveBeenCalledWith(input.id, {
      name: 'Latest B',
      sport_hint: 'run',
      waypoints: input.waypoints,
    });
    expect(server.name).toBe('Latest B');
    expect(await repository.getRoute(owner, input.id)).toMatchObject({
      name: 'Latest B',
      sync_status: 'synced',
    });
  });
  it('confirms an unknown create commit after changed-payload 409 then PATCHes latest state', async () => {
    const repository = new MemoryRouteRepository();
    await repository.createRoute(owner, input, 0);
    let server: Route | null = null;
    let first = true;
    const createRoute = vi.fn(async (request: CreateRouteRequest) => {
      if (first) {
        first = false;
        server = serverRoute(request);
        throw new Error('timeout after commit');
      }
      if (server && server.name !== request.name)
        throw new ApiResponseError(409, 'idempotency_conflict');
      return server!;
    });
    const getRoute = vi.fn(async () => server!);
    const updateRoute = vi.fn(
      async (_id: string, patch: UpdateRouteRequest) => {
        server = { ...server!, name: patch.name ?? server!.name };
        return server;
      },
    );
    let now = 0;
    const engine = new RouteSyncEngine(
      repository,
      { createRoute, getRoute, updateRoute, deleteRoute: vi.fn() },
      () => now,
      () => 0,
    );
    await engine.trigger(owner);
    await repository.updateRoute(owner, input.id, { name: 'Latest B' }, 1);
    now = 1;
    await engine.trigger(owner);
    expect(createRoute).toHaveBeenCalledTimes(2);
    expect(getRoute).toHaveBeenCalledWith(input.id);
    expect(updateRoute).toHaveBeenCalledWith(input.id, {
      name: 'Latest B',
      sport_hint: 'run',
      waypoints: input.waypoints,
    });
    expect((server as Route | null)?.name).toBe('Latest B');
    expect(await repository.getRoute(owner, input.id)).toMatchObject({
      name: 'Latest B',
      sync_status: 'synced',
    });
  });
  it('ignores delayed update completion and failure after a newer revision exists', async () => {
    const repository = new MemoryRouteRepository();
    await repository.createRoute(owner, input, 0);
    await repository.completeRouteSyncJob(
      (await repository.nextRouteSyncJob(owner, 0))!,
      serverRoute(input),
    );
    await repository.updateRoute(owner, input.id, { name: 'Update A' }, 1);
    const updateA = (await repository.nextRouteSyncJob(owner, 1))!;
    await repository.updateRoute(owner, input.id, { name: 'Update B' }, 2);
    const updateB = (await repository.nextRouteSyncJob(owner, 2))!;
    expect(updateB.revision).toBeGreaterThan(updateA.revision);
    await repository.completeRouteSyncJob(updateA, {
      ...serverRoute(input),
      name: 'Update A',
    });
    expect(await repository.getRoute(owner, input.id)).toMatchObject({
      name: 'Update B',
      sync_status: 'pending',
      revision: updateB.revision,
    });
    expect((await repository.nextRouteSyncJob(owner, 2))?.revision).toBe(
      updateB.revision,
    );
    await repository.failRouteSyncJob(updateA, 10_000, true);
    expect(await repository.getRoute(owner, input.id)).toMatchObject({
      name: 'Update B',
      sync_status: 'pending',
    });
    await repository.completeRouteSyncJob(updateB, {
      ...serverRoute(input),
      name: 'Update B',
    });
    expect(await repository.getRoute(owner, input.id)).toMatchObject({
      name: 'Update B',
      sync_status: 'synced',
    });
  });
  it('keeps newer delete jobs when stale create or update responses finish', async () => {
    const createRepository = new MemoryRouteRepository();
    await createRepository.createRoute(owner, input, 0);
    const createJob = (await createRepository.nextRouteSyncJob(owner, 0))!;
    await createRepository.deleteRoute(owner, input.id, 1);
    const deleteAfterCreate = (await createRepository.nextRouteSyncJob(
      owner,
      1,
    ))!;
    await createRepository.completeRouteSyncJob(createJob, serverRoute(input));
    expect((await createRepository.nextRouteSyncJob(owner, 1))?.revision).toBe(
      deleteAfterCreate.revision,
    );
    expect(await createRepository.getRoute(owner, input.id)).toBeNull();

    const updateRepository = new MemoryRouteRepository();
    await updateRepository.createRoute(owner, input, 0);
    await updateRepository.completeRouteSyncJob(
      (await updateRepository.nextRouteSyncJob(owner, 0))!,
      serverRoute(input),
    );
    await updateRepository.updateRoute(owner, input.id, { name: 'A' }, 2);
    const updateJob = (await updateRepository.nextRouteSyncJob(owner, 2))!;
    await updateRepository.deleteRoute(owner, input.id, 3);
    const deleteAfterUpdate = (await updateRepository.nextRouteSyncJob(
      owner,
      3,
    ))!;
    await updateRepository.completeRouteSyncJob(updateJob, {
      ...serverRoute(input),
      name: 'A',
    });
    expect((await updateRepository.nextRouteSyncJob(owner, 3))?.revision).toBe(
      deleteAfterUpdate.revision,
    );
    expect(await updateRepository.getRoute(owner, input.id)).toBeNull();
  });
  it('retains confirmed tombstones across stale list completion and restart for 30 days', async () => {
    const repository = new MemoryRouteRepository();
    await repository.createRoute(owner, input, 0);
    await repository.completeRouteSyncJob(
      (await repository.nextRouteSyncJob(owner, 0))!,
      serverRoute(input),
    );
    const staleListStartedBeforeDelete = [serverRoute(input)];
    await repository.deleteRoute(owner, input.id, 100);
    const deleteJob = (await repository.nextRouteSyncJob(owner, 100))!;
    await repository.completeRouteSyncJob(deleteJob);
    const tombstone = await repository.getRouteTombstone(owner, input.id);
    expect(tombstone).toEqual({
      ownerUserId: owner,
      routeId: input.id,
      revision: deleteJob.revision,
      deletedAtMs: 100,
      status: 'synced',
    });
    expect(JSON.stringify(tombstone)).not.toContain(input.name);
    expect(JSON.stringify(tombstone)).not.toContain('encoded');
    await repository.mergeRemoteRoutes(owner, staleListStartedBeforeDelete);
    expect(await repository.getRoute(owner, input.id)).toBeNull();
    const reopened = repository.reopen();
    await reopened.mergeRemoteRoutes(owner, staleListStartedBeforeDelete);
    expect(await reopened.getRoute(owner, input.id)).toBeNull();
    await reopened.purgeExpiredRouteTombstones(
      owner,
      100 + ROUTE_TOMBSTONE_RETENTION_MS - 1,
    );
    await reopened.mergeRemoteRoutes(owner, staleListStartedBeforeDelete);
    expect(await reopened.getRoute(owner, input.id)).toBeNull();
    await reopened.purgeExpiredRouteTombstones(
      owner,
      100 + ROUTE_TOMBSTONE_RETENTION_MS,
    );
    await reopened.mergeRemoteRoutes(owner, staleListStartedBeforeDelete);
    expect(await reopened.getRoute(owner, input.id)).not.toBeNull();
  });
  it('marks opaque conflicts needs_attention and supports explicit retry', async () => {
    const repository = new MemoryRouteRepository();
    await repository.createRoute(owner, input, 0);
    const api = {
      createRoute: vi.fn(async () => {
        throw new ApiResponseError(409, 'idempotency_conflict');
      }),
      getRoute: vi.fn(async () => {
        throw new ApiResponseError(404, 'not_found');
      }),
      updateRoute: vi.fn(async () => serverRoute(input)),
      deleteRoute: vi.fn(),
    };
    const engine = new RouteSyncEngine(
      repository,
      api,
      () => 0,
      () => 0,
    );
    await engine.trigger(owner);
    expect((await repository.getRoute(owner, input.id))?.sync_status).toBe(
      'needs_attention',
    );
    await engine.manualRetry(owner);
    expect(api.createRoute).toHaveBeenCalledTimes(2);
    await repository.createRoute(
      other,
      { ...input, id: '22222222-2222-4222-8222-222222222222' },
      1,
    );
    await repository.purgeOwnerRoutes(owner);
    expect(await repository.listRoutes(owner)).toEqual([]);
    expect(await repository.listRoutes(other)).toHaveLength(1);
  });
});
