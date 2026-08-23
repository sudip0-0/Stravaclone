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
        identity_token: 'sensitive-provider-token',
        jwt_signing_key: 'sensitive-jwt-key',
        email_outbox_key: 'sensitive-email-key',
        refresh_recovery_key: 'sensitive-recovery-key',
        object_storage_secret_key: 'sensitive-object-secret',
        password: 'sensitive-password',
        password_hash: 'sensitive-password-hash',
        refresh_token: 'sensitive-refresh',
        rotation_request_id: 'sensitive-rotation-id',
        payload_ciphertext: 'sensitive-payload-ciphertext',
        payload_iv: 'sensitive-payload-iv',
        payload_tag: 'sensitive-payload-tag',
        successor_ciphertext: 'sensitive-successor-ciphertext',
        successor_iv: 'sensitive-successor-iv',
        successor_tag: 'sensitive-successor-tag',
        signed_url: 'https://objects.invalid/sensitive-signature',
        upload_url: 'https://objects.invalid/sensitive-upload-signature',
        download_url: 'https://objects.invalid/sensitive-download-signature',
        form_fields: {
          policy: 'sensitive-post-policy',
          signature: 'sensitive-post-field-signature',
        },
        points: [{ latitude: 51.501, longitude: -0.141 }],
        gps: [[51.501, -0.141]],
        exif: { GPSLatitude: 'sensitive-exif-latitude' },
        metadata: {
          capture_latitude: 'sensitive-capture-latitude',
          capture_longitude: 'sensitive-capture-longitude',
        },
        provider_token: 'sensitive-provider-oauth-token',
        access_token: 'sensitive-provider-access-token',
        smtp_password: 'sensitive-smtp-password',
        token: 'sensitive-token-value',
        token_hash: 'sensitive-token-hash',
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
      'sensitive-provider-token',
      'sensitive-jwt-key',
      'sensitive-email-key',
      'sensitive-recovery-key',
      'sensitive-object-secret',
      'sensitive-password',
      'sensitive-password-hash',
      'sensitive-token-hash',
      'sensitive-refresh',
      'sensitive-rotation-id',
      'sensitive-payload-ciphertext',
      'sensitive-payload-iv',
      'sensitive-payload-tag',
      'sensitive-successor-ciphertext',
      'sensitive-successor-iv',
      'sensitive-successor-tag',
      'sensitive-signature',
      'sensitive-upload-signature',
      'sensitive-download-signature',
      'sensitive-post-policy',
      'sensitive-post-field-signature',
      '51.501',
      '-0.141',
      'sensitive-exif-latitude',
      'sensitive-capture-latitude',
      'sensitive-capture-longitude',
      'sensitive-provider-oauth-token',
      'sensitive-provider-access-token',
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

  it('logs a fixed route label for unmatched secret paths', async () => {
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

    const response = await app.inject({
      method: 'GET',
      url: '/secret-404-account/secret-404-token?key=secret-404-query',
    });
    await app.close();

    expect(response.statusCode).toBe(404);
    expect(logs).toContain('unmatched-route');
    expect(logs).not.toContain('secret-404-account');
    expect(logs).not.toContain('secret-404-token');
    expect(logs).not.toContain('secret-404-query');
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
