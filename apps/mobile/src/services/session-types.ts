import type { SessionTokens } from '@trail/contracts';

export type StoredSession = SessionTokens;
export interface PendingRotation {
  rotationRequestId: string;
  refreshToken: string;
}

export interface SessionStore {
  read(): Promise<StoredSession | null>;
  write(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
  readPendingRotation(): Promise<PendingRotation | null>;
  writePendingRotation(pending: PendingRotation): Promise<void>;
  clearPendingRotation(): Promise<void>;
}

export class TerminalSessionError extends Error {
  constructor() {
    super('Your session ended. Please sign in again.');
    this.name = 'TerminalSessionError';
  }
}

export type SessionRetryReason =
  | 'offline'
  | 'rate-limit'
  | 'server'
  | 'unknown';
export class RetryableSessionError extends Error {
  constructor(public readonly reason: SessionRetryReason) {
    super('Your session could not be refreshed. Try again.');
    this.name = 'RetryableSessionError';
  }
}
