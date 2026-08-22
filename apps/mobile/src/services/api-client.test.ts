import { describe, expect, it } from 'vitest';
import type { SessionTokens } from '@trail/contracts';
import { ApiClient } from './api-client';
import { SessionCoordinator } from './session-coordinator';
import type { PendingRotation, SessionStore } from './session-types';

const tokens: SessionTokens = {
  access_token: 'access',
  refresh_token: 'refresh',
  access_token_expires_at: '2099-01-01T00:00:00.000Z',
  refresh_token_expires_at: '2099-02-01T00:00:00.000Z',
  token_type: 'Bearer',
};
class Store implements SessionStore {
  constructor(public value: SessionTokens | null = tokens) {}
  pending: PendingRotation | null = null;
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
async function authenticatedClient(fetcher: typeof fetch) {
  const api = new ApiClient('https://api.example.test', fetcher);
  const session = new SessionCoordinator(new Store(), api);
  await session.restore();
  api.session = session;
  return api;
}
const payloadFrom = (init?: RequestInit): unknown => {
  if (typeof init?.body !== 'string')
    throw new Error('Expected JSON request body');
  return JSON.parse(init.body);
};
const urlFrom = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

describe('ApiClient auth and handoff payloads', () => {
  it('accepts registration without creating a session, then stores the confirmed session', async () => {
    const store = new Store(null);
    const fetcher: typeof fetch = async (input) => {
      const path = urlFrom(input);
      if (path.endsWith('/v1/auth/register'))
        return new Response(JSON.stringify({ accepted: true }), {
          status: 202,
        });
      return new Response(
        JSON.stringify({
          user_id: '123e4567-e89b-42d3-a456-426614174000',
          session: tokens,
        }),
        { status: 200 },
      );
    };
    const api = new ApiClient('https://api.example.test', fetcher);
    const coordinator = new SessionCoordinator(store, api);
    api.session = coordinator;
    await expect(
      api.requestRegistration('new@example.com', 'password1'),
    ).resolves.toBeUndefined();
    expect(store.value).toBeNull();
    const confirmed = await api.confirmRegistration('x'.repeat(32));
    await coordinator.establish(confirmed.session);
    expect(store.value).toEqual(tokens);
  });

  it('returns the same accepted result for new and existing email requests', async () => {
    const payloads: unknown[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      payloads.push(payloadFrom(init));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    };
    const api = new ApiClient('https://api.example.test', fetcher);
    const first = await api.requestRegistration('new@example.com', 'password1');
    const second = await api.requestRegistration(
      'existing@example.com',
      'password1',
    );
    expect(first).toBe(second);
    expect(payloads).toHaveLength(2);
  });

  it('sends the stable rotation_request_id with refresh', async () => {
    let payload: unknown;
    const fetcher: typeof fetch = async (_input, init) => {
      payload = payloadFrom(init);
      return new Response(
        JSON.stringify({
          user_id: '123e4567-e89b-42d3-a456-426614174000',
          session: tokens,
        }),
        { status: 200 },
      );
    };
    const api = new ApiClient('https://api.example.test', fetcher);
    await api.refresh('refresh', '123e4567-e89b-42d3-a456-426614174000');
    expect(payload).toEqual({
      refresh_token: 'refresh',
      rotation_request_id: '123e4567-e89b-42d3-a456-426614174000',
    });
  });

  it('accepts 204 password reset confirmation without parsing JSON', async () => {
    let payload: unknown;
    const fetcher: typeof fetch = async (_input, init) => {
      payload = payloadFrom(init);
      return new Response(null, { status: 204 });
    };
    const api = new ApiClient('https://api.example.test', fetcher);
    await expect(
      api.confirmPasswordReset('x'.repeat(32), 'password1'),
    ).resolves.toBeUndefined();
    expect(payload).toEqual({ token: 'x'.repeat(32), password: 'password1' });
  });

  it('sends current password for deletion and accepts 204', async () => {
    let payload: unknown;
    const fetcher: typeof fetch = async (_input, init) => {
      payload = payloadFrom(init);
      return new Response(null, { status: 204 });
    };
    const api = await authenticatedClient(fetcher);
    await expect(
      api.deleteAccount('current-password'),
    ).resolves.toBeUndefined();
    expect(payload).toEqual({
      confirmation: 'DELETE',
      password: 'current-password',
    });
  });

  it('keeps credentials and performs exactly one DELETE without refresh for 403 step_up_failed', async () => {
    const store = new Store(tokens);
    const requests: { method: string; url: string }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ method: init?.method ?? 'GET', url: urlFrom(input) });
      return new Response(
        JSON.stringify({ error: { code: 'step_up_failed', message: 'safe' } }),
        { status: 403 },
      );
    };
    const api = new ApiClient('https://api.example.test', fetcher);
    const coordinator = new SessionCoordinator(store, api);
    await coordinator.restore();
    api.session = coordinator;
    await expect(api.deleteAccount('wrong-password')).rejects.toMatchObject({
      status: 403,
      code: 'step_up_failed',
    });
    expect(requests).toEqual([
      { method: 'DELETE', url: 'https://api.example.test/v1/me' },
    ]);
    expect(store.value).toEqual(tokens);
    expect(coordinator.current).toEqual(tokens);
  });

  it('uploads managed photo bytes with signed POST form fields', async () => {
    let uploadInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      if (urlFrom(input) === 'file:///managed/photo.jpg')
        return new Response(new Blob(['photo-bytes'], { type: 'image/jpeg' }), {
          status: 200,
        });
      uploadInit = init;
      return new Response(null, { status: 204 });
    };
    const api = new ApiClient('https://api.example.test', fetcher);
    await api.uploadPhoto(
      {
        photo_id: '123e4567-e89b-42d3-a456-426614174000',
        status: 'pending',
        upload_url: 'https://storage.example.test',
        expires_at: '2099-01-01T00:15:00.000Z',
        form_fields: { key: 'owner/staging', 'Content-Type': 'image/jpeg' },
      },
      'file:///managed/photo.jpg',
      11,
    );
    expect(uploadInit?.method).toBe('POST');
    expect(uploadInit?.body).toBeInstanceOf(FormData);
    const form = uploadInit?.body as FormData;
    expect(form.get('key')).toBe('owner/staging');
    expect(form.get('Content-Type')).toBe('image/jpeg');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('preserves step_up_required for an SSO-only deletion response', async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'step_up_required', message: 'safe' },
        }),
        { status: 409 },
      );
    const api = await authenticatedClient(fetcher);
    await expect(api.deleteAccount('provided-value')).rejects.toMatchObject({
      status: 409,
      code: 'step_up_required',
    });
  });
});
