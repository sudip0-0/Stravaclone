import { describe, expect, it, vi } from 'vitest';
import type { SessionTokens } from '@trail/contracts';
import { ApiResponseError } from './errors';
import { SessionCoordinator } from './session-coordinator';
import {
  TerminalSessionError,
  type PendingRotation,
  type SessionStore,
} from './session-types';

const session = (
  access = 'access',
  refresh = 'refresh',
  expired = false,
): SessionTokens => ({
  access_token: access,
  refresh_token: refresh,
  access_token_expires_at: expired
    ? '2020-01-01T00:00:00.000Z'
    : '2099-01-01T00:00:00.000Z',
  refresh_token_expires_at: '2099-02-01T00:00:00.000Z',
  token_type: 'Bearer',
});
class MemoryStore implements SessionStore {
  pending: PendingRotation | null = null;
  constructor(public value: SessionTokens | null) {}
  async read() {
    return this.value;
  }
  async write(value: SessionTokens) {
    this.value = value;
  }
  async clear() {
    this.value = null;
    this.pending = null;
  }
  async readPendingRotation() {
    return this.pending;
  }
  async writePendingRotation(value: PendingRotation) {
    this.pending = value;
  }
  async clearPendingRotation() {
    this.pending = null;
  }
}
const requestId = '123e4567-e89b-42d3-a456-426614174000';

describe('SessionCoordinator', () => {
  it('refreshes expired access on cold start and durably persists both rotated tokens', async () => {
    const store = new MemoryStore(session('old-access', 'old-refresh', true));
    const refresh = vi.fn(async () => session('new-access', 'new-refresh'));
    const coordinator = new SessionCoordinator(
      store,
      { refresh },
      vi.fn(),
      () => requestId,
    );
    await expect(coordinator.restore()).resolves.toBe('authenticated');
    expect(refresh).toHaveBeenCalledWith('old-refresh', requestId);
    expect(store.value).toEqual(
      expect.objectContaining({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
      }),
    );
    expect(store.pending).toBeNull();
  });

  it('survives a simulated crash and retries the same rotation request ID', async () => {
    const store = new MemoryStore(session('old-access', 'old-refresh', true));
    const firstTransport = {
      refresh: vi.fn(async () => {
        throw new TypeError('connection lost after send');
      }),
    };
    const first = new SessionCoordinator(
      store,
      firstTransport,
      vi.fn(),
      () => requestId,
    );
    await expect(first.restore()).resolves.toBe('retry');
    expect(store.pending?.rotationRequestId).toBe(requestId);
    const secondTransport = {
      refresh: vi.fn(async () => session('new-access', 'new-refresh')),
    };
    const restarted = new SessionCoordinator(
      store,
      secondTransport,
      vi.fn(),
      () => 'different-id',
    );
    await expect(restarted.restore()).resolves.toBe('authenticated');
    expect(secondTransport.refresh).toHaveBeenCalledWith(
      'old-refresh',
      requestId,
    );
    expect(store.pending).toBeNull();
  });

  it.each([
    [new TypeError('offline'), 'offline'],
    [new ApiResponseError(429, 'rate_limited'), 'rate-limit'],
    [new ApiResponseError(503, 'service_unavailable'), 'server'],
  ] as const)(
    'retains tokens and pending rotation for transient failure %#',
    async (failure, reason) => {
      const original = session('access', 'refresh', true);
      const store = new MemoryStore(original);
      const coordinator = new SessionCoordinator(
        store,
        {
          refresh: async () => {
            throw failure;
          },
        },
        vi.fn(),
        () => requestId,
      );
      await expect(coordinator.restore()).resolves.toBe('retry');
      expect(coordinator.retryState).toBe(reason);
      expect(store.value).toEqual(original);
      expect(store.pending?.rotationRequestId).toBe(requestId);
    },
  );

  it.each([
    [401, 'unauthorized'],
    [403, 'invalid_credentials'],
  ] as const)(
    'clears credentials for terminal refresh status %s',
    async (status, code) => {
      const store = new MemoryStore(session());
      const terminal = vi.fn();
      const coordinator = new SessionCoordinator(
        store,
        {
          refresh: async () => {
            throw new ApiResponseError(status, code);
          },
        },
        terminal,
        () => requestId,
      );
      await coordinator.restore();
      await expect(coordinator.refresh()).rejects.toBeInstanceOf(
        TerminalSessionError,
      );
      expect(store.value).toBeNull();
      expect(store.pending).toBeNull();
      expect(terminal).toHaveBeenCalledTimes(1);
    },
  );

  it('coordinates concurrent 401 refresh into one flight and replays each request once', async () => {
    const store = new MemoryStore(session());
    let resolve!: (value: SessionTokens) => void;
    const refresh = vi.fn(
      () =>
        new Promise<SessionTokens>((done) => {
          resolve = done;
        }),
    );
    const coordinator = new SessionCoordinator(
      store,
      { refresh },
      vi.fn(),
      () => requestId,
    );
    await coordinator.restore();
    let calls = 0;
    const fetcher = vi.fn(
      async () => new Response(null, { status: ++calls <= 2 ? 401 : 200 }),
    );
    const first = coordinator.authorizedFetch(
      'https://api.test/me',
      {},
      fetcher,
    );
    const second = coordinator.authorizedFetch(
      'https://api.test/me',
      {},
      fetcher,
    );
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    resolve(session('next', 'rotated'));
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('terminates after exactly one replay returns 401', async () => {
    const coordinator = new SessionCoordinator(
      new MemoryStore(session()),
      { refresh: async () => session('next', 'rotated') },
      vi.fn(),
      () => requestId,
    );
    await coordinator.restore();
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
    await expect(
      coordinator.authorizedFetch('https://api.test/me', {}, fetcher),
    ).rejects.toBeInstanceOf(TerminalSessionError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
