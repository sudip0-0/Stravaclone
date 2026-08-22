import type { SessionTokens } from '@trail/contracts';
import { ApiResponseError } from './errors';
import {
  RetryableSessionError,
  TerminalSessionError,
  type SessionRetryReason,
  type SessionStore,
} from './session-types';

export interface RefreshTransport {
  refresh(
    refreshToken: string,
    rotationRequestId: string,
  ): Promise<SessionTokens>;
}
export type SessionRestoreResult = 'authenticated' | 'signed-out' | 'retry';

function retryReason(error: unknown): SessionRetryReason {
  if (error instanceof TypeError) return 'offline';
  if (error instanceof ApiResponseError) {
    if (error.status === 429) return 'rate-limit';
    if (error.status >= 500) return 'server';
  }
  return 'unknown';
}
function isTerminal(error: unknown): boolean {
  return (
    error instanceof ApiResponseError &&
    (error.status === 401 ||
      error.status === 403 ||
      error.code === 'invalid_credentials' ||
      error.code === 'unauthorized')
  );
}

export class SessionCoordinator {
  private session: SessionTokens | null = null;
  private refreshFlight: Promise<SessionTokens> | null = null;
  private retryReasonValue: SessionRetryReason | null = null;

  constructor(
    private readonly store: SessionStore,
    private readonly transport: RefreshTransport,
    private readonly onTerminal: () => void = () => undefined,
    private readonly createRotationRequestId: () => string = () =>
      globalThis.crypto.randomUUID(),
  ) {}

  get current(): SessionTokens | null {
    return this.session;
  }
  get retryState(): SessionRetryReason | null {
    return this.retryReasonValue;
  }

  async restore(): Promise<SessionRestoreResult> {
    this.session = await this.store.read();
    if (!this.session) return 'signed-out';
    const pending = await this.store.readPendingRotation();
    if (pending && pending.refreshToken !== this.session.refresh_token)
      await this.store.clearPendingRotation();
    if (Date.parse(this.session.refresh_token_expires_at) <= Date.now()) {
      await this.terminate();
      return 'signed-out';
    }
    if (Date.parse(this.session.access_token_expires_at) <= Date.now()) {
      try {
        await this.refresh();
      } catch (error) {
        if (error instanceof RetryableSessionError) return 'retry';
        return 'signed-out';
      }
    }
    return 'authenticated';
  }

  async establish(session: SessionTokens): Promise<void> {
    await this.store.write(session);
    this.session = session;
    this.retryReasonValue = null;
    await this.store.clearPendingRotation();
  }

  async clear(): Promise<void> {
    this.session = null;
    this.retryReasonValue = null;
    await this.store.clear();
  }

  async refresh(): Promise<SessionTokens> {
    if (!this.session) throw new TerminalSessionError();
    if (!this.refreshFlight)
      this.refreshFlight = this.performRefresh().finally(() => {
        this.refreshFlight = null;
      });
    return this.refreshFlight;
  }

  async authorizedFetch(
    input: string,
    init: RequestInit = {},
    fetcher: typeof fetch = fetch,
  ): Promise<Response> {
    if (!this.session) throw new TerminalSessionError();
    const send = (token: string) =>
      fetcher(input, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...init.headers,
          Authorization: `Bearer ${token}`,
        },
      });
    const first = await send(this.session.access_token);
    if (first.status !== 401) return first;
    const next = await this.refresh();
    const replay = await send(next.access_token);
    if (replay.status === 401) {
      await this.terminate();
      throw new TerminalSessionError();
    }
    return replay;
  }

  private async performRefresh(): Promise<SessionTokens> {
    const current = this.session;
    if (!current) throw new TerminalSessionError();
    let pending = await this.store.readPendingRotation();
    if (pending && pending.refreshToken !== current.refresh_token) {
      await this.store.clearPendingRotation();
      pending = null;
    }
    if (!pending) {
      pending = {
        refreshToken: current.refresh_token,
        rotationRequestId: this.createRotationRequestId(),
      };
      await this.store.writePendingRotation(pending);
    }
    try {
      const next = await this.transport.refresh(
        current.refresh_token,
        pending.rotationRequestId,
      );
      await this.establish(next);
      return next;
    } catch (error) {
      if (isTerminal(error)) {
        await this.terminate();
        throw new TerminalSessionError();
      }
      this.retryReasonValue = retryReason(error);
      throw new RetryableSessionError(this.retryReasonValue);
    }
  }

  private async terminate(): Promise<void> {
    await this.clear();
    this.onTerminal();
  }
}
