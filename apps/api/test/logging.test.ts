import { describe, expect, it } from 'vitest';
import { buildApp, createLoggerOptions } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { createTestProviders } from '../src/providers/test.js';
import { validEnvironment } from './fixtures.js';

describe('logging privacy', () => {
  it('redacts credentials, tokens, cookies, and signed URLs', async () => {
    let logs = '';
    const config = parseConfig({
      ...validEnvironment,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
    });
    const app = buildApp({
      config,
      providers: createTestProviders(),
      logger: {
        ...createLoggerOptions(config),
        stream: { write: (line: string) => (logs += line) },
      },
    });

    app.log.info(
      {
        authorization: 'Bearer sensitive-token',
        cookie: 'session=sensitive-cookie',
        object_storage_secret_key: 'sensitive-object-secret',
        password: 'sensitive-password',
        refresh_token: 'sensitive-refresh',
        signed_url: 'https://objects.invalid/sensitive-signature',
        smtp_password: 'sensitive-smtp-password',
        token: 'sensitive-token-value',
      },
      'redaction probe',
    );
    const response = await app.inject({
      headers: {
        authorization: 'Bearer sensitive-header',
        cookie: 'session=sensitive-header-cookie',
        'x-request-id': 'sensitive-id?token=request-secret',
      },
      method: 'GET',
      url: '/health?token=query-token&code=query-code&state=query-state&signed_url=query-signature',
    });
    await app.close();

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    for (const secret of [
      'sensitive-token',
      'sensitive-cookie',
      'sensitive-object-secret',
      'sensitive-password',
      'sensitive-refresh',
      'sensitive-signature',
      'sensitive-smtp-password',
      'sensitive-header',
      'query-token',
      'query-code',
      'query-state',
      'query-signature',
      'request-secret',
      'sensitive-id',
    ]) {
      expect(logs).not.toContain(secret);
    }
    expect(logs).toContain('[REDACTED]');
  });

  it('does not log arbitrary exception messages or send them to telemetry', async () => {
    let logs = '';
    const telemetryEvents: unknown[] = [];
    const config = parseConfig({
      ...validEnvironment,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
    });
    const app = buildApp({
      config,
      providers: {
        ...createTestProviders(),
        telemetry: {
          captureException: (event) => telemetryEvents.push(event),
        },
      },
      logger: {
        ...createLoggerOptions(config),
        stream: { write: (line: string) => (logs += line) },
      },
    });
    app.get('/failure', async () => {
      throw new Error('smtp_password=sensitive-exception-value');
    });

    await app.inject({ method: 'GET', url: '/failure' });
    await app.close();

    expect(logs).not.toContain('sensitive-exception-value');
    expect(telemetryEvents).toEqual([
      { code: 'internal_error', requestId: expect.any(String) },
    ]);
  });
});
