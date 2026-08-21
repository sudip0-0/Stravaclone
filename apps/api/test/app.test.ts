import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { ApplicationError } from '../src/http/application-error.js';
import { createTestProviders } from '../src/providers/test.js';
import { testConfig } from './fixtures.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () =>
  Promise.all(apps.splice(0).map(async (app) => app.close())),
);

describe('platform endpoints', () => {
  it('reports liveness and propagates a request ID', async () => {
    const app = buildApp({
      config: testConfig,
      providers: createTestProviders(),
    });
    apps.push(app);
    const response = await app.inject({
      headers: { 'x-request-id': 'test-request' },
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('test-request');
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns only aggregate readiness and skips disabled email', async () => {
    const providers = createTestProviders('up');
    const emailCheck = vi.spyOn(providers.email, 'checkHealth');
    const readyApp = buildApp({ config: testConfig, providers });
    const unavailableApp = buildApp({
      config: testConfig,
      providers: createTestProviders('down'),
    });
    apps.push(readyApp, unavailableApp);

    expect(
      (await readyApp.inject({ method: 'GET', url: '/ready' })).json(),
    ).toEqual({ status: 'ready' });
    expect(emailCheck).not.toHaveBeenCalled();
    const response = await unavailableApp.inject({
      method: 'GET',
      url: '/ready',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
  });

  it('does not accumulate permanently stalled probes and releases them on settlement', async () => {
    let resolveStalled!: (status: 'up') => void;
    const stalled = new Promise<'up'>((resolve) => {
      resolveStalled = resolve;
    });
    const providers = createTestProviders('up');
    const databaseCheck = vi
      .spyOn(providers.database, 'checkHealth')
      .mockReturnValue(stalled);
    const app = buildApp({
      config: { ...testConfig, READINESS_CACHE_MS: 0 },
      providers,
    });
    apps.push(app);

    const startedAt = Date.now();
    const first = await app.inject({ method: 'GET', url: '/ready' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await app.inject({ method: 'GET', url: '/ready' });

    expect(first.statusCode).toBe(503);
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(second.statusCode).toBe(503);
    expect(databaseCheck).toHaveBeenCalledTimes(1);

    resolveStalled('up');
    await stalled;
    await new Promise((resolve) => setTimeout(resolve, 2));
    await app.inject({ method: 'GET', url: '/ready' });
    expect(databaseCheck).toHaveBeenCalledTimes(2);
  });

  it('uses the standard error envelope for unknown routes', async () => {
    const app = buildApp({
      config: testConfig,
      providers: createTestProviders(),
    });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'not_found', message: 'Route not found' },
    });
  });

  it('returns typed safe errors and never arbitrary exception messages', async () => {
    const captureException = vi.fn();
    const providers = {
      ...createTestProviders(),
      telemetry: { captureException },
    };
    const app = buildApp({ config: testConfig, providers });
    apps.push(app);
    app.get('/safe-error', async () => {
      throw new ApplicationError({
        code: 'service_unavailable',
        statusCode: 503,
        publicMessage: 'Service temporarily unavailable',
      });
    });
    app.get('/unknown-error', async () => {
      throw new Error('password=do-not-return-this');
    });

    expect(
      (await app.inject({ method: 'GET', url: '/safe-error' })).json(),
    ).toEqual({
      error: {
        code: 'service_unavailable',
        message: 'Service temporarily unavailable',
      },
    });
    const unknown = await app.inject({ method: 'GET', url: '/unknown-error' });
    expect(unknown.statusCode).toBe(500);
    expect(unknown.body).not.toContain('do-not-return-this');
    expect(unknown.json()).toEqual({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred',
      },
    });
    expect(captureException).toHaveBeenCalledWith({
      code: 'internal_error',
      requestId: expect.any(String),
    });
  });
});
