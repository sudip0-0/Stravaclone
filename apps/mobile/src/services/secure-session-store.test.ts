import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTokens } from '@trail/contracts';

const values = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    values.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    values.delete(key);
  }),
}));

import { SecureSessionStore } from './secure-session-store';

const tokens: SessionTokens = {
  access_token: 'access',
  refresh_token: 'refresh',
  access_token_expires_at: '2099-01-01T00:00:00.000Z',
  refresh_token_expires_at: '2099-02-01T00:00:00.000Z',
  token_type: 'Bearer',
};
const pending = {
  refreshToken: 'refresh',
  rotationRequestId: '123e4567-e89b-42d3-a456-426614174000',
};

describe('SecureSessionStore rotation recovery metadata', () => {
  beforeEach(() => values.clear());
  it('persists session tokens and pending rotation separately in secure storage', async () => {
    const store = new SecureSessionStore();
    await store.write(tokens);
    await store.writePendingRotation(pending);
    await expect(store.read()).resolves.toEqual(tokens);
    await expect(store.readPendingRotation()).resolves.toEqual(pending);
  });
  it('clears pending metadata only after the caller durably writes replacement tokens', async () => {
    const store = new SecureSessionStore();
    await store.write(tokens);
    await store.writePendingRotation(pending);
    await store.write({
      ...tokens,
      access_token: 'next',
      refresh_token: 'rotated',
    });
    await expect(store.readPendingRotation()).resolves.toEqual(pending);
    await store.clearPendingRotation();
    await expect(store.readPendingRotation()).resolves.toBeNull();
    await expect(store.read()).resolves.toMatchObject({
      access_token: 'next',
      refresh_token: 'rotated',
    });
  });
});
