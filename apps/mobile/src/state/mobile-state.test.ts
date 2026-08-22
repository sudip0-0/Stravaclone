import { describe, expect, it, vi } from 'vitest';
import type { User } from '@trail/contracts';
import { ApiResponseError, mapApiError } from '../services/errors';
import {
  clearDraftReporter,
  evaluateSignOut,
  resolveDraftReporter,
} from './draft-guard';
import { AppProfileStore } from './profile-state';

const user = (units: User['units']): User => ({
  id: '123e4567-e89b-42d3-a456-426614174000',
  email: 'a@example.com',
  display_name: 'A',
  avatar_url: null,
  units,
  default_sport: 'run',
  identities: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('production app profile store and draft reporter wiring', () => {
  it('propagates profile unit changes through the store used by AppStateProvider', () => {
    const store = new AppProfileStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(user('metric'));
    store.set(user('imperial'));
    expect(store.get()?.units).toBe('imperial');
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it('uses an injected production reporter and defaults explicitly to clear until Phase 3', async () => {
    const injected = { getDraftState: vi.fn(async () => 'recording' as const) };
    expect(resolveDraftReporter(injected)).toBe(injected);
    expect(resolveDraftReporter()).toBe(clearDraftReporter);
    const decision = await evaluateSignOut(resolveDraftReporter(injected));
    expect(decision).toMatchObject({ allowed: false, destination: 'Record' });
    expect(injected.getDraftState).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['recording', 'Record'],
    ['pending-upload', 'Activity'],
  ] as const)(
    'blocks sign-out for %s without clearing draft data',
    async (draft, destination) => {
      const getDraftState = vi.fn(async () => draft);
      const decision = await evaluateSignOut({ getDraftState });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.destination).toBe(destination);
      expect(getDraftState).toHaveBeenCalledTimes(1);
    },
  );
});

describe('safe error mapping', () => {
  it('never exposes server or credential details', () => {
    expect(
      mapApiError(new ApiResponseError(401, 'unauthorized'), 'sign-in').message,
    ).toBe('Email or password is incorrect.');
    expect(mapApiError(new Error('token=secret')).message).toBe(
      'Something went wrong. Try again.',
    );
  });
  it('maps offline, rate limit, validation, and service failures to stable messages', () => {
    expect(mapApiError(new TypeError('fetch failed')).kind).toBe('offline');
    expect(mapApiError(new ApiResponseError(429, 'rate_limited')).kind).toBe(
      'rate-limit',
    );
    expect(
      mapApiError(new ApiResponseError(400, 'validation_error')).kind,
    ).toBe('validation');
    expect(
      mapApiError(new ApiResponseError(503, 'service_unavailable')).retryable,
    ).toBe(true);
  });
});
