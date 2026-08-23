import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));

describe('OpenTelemetry HTTP integration', () => {
  it('exports only trusted matched and unmatched routes through real OTLP', () => {
    const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const child = spawnSync(
      executable,
      ['exec', 'tsx', 'test/telemetry-integration-child.ts'],
      {
        cwd: apiRoot,
        encoding: 'utf8',
        maxBuffer: 5 * 1024 * 1024,
        shell: process.platform === 'win32',
        timeout: 60_000,
      },
    );
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
    const serialized = child.stdout
      .split('\n')
      .find((line) => line.startsWith('OTEL_REQUESTS='))
      ?.slice('OTEL_REQUESTS='.length);
    expect(serialized).toBeDefined();
    const requests = JSON.parse(serialized!) as Array<{
      method: string;
      url: string;
      contentType: string;
      bodyBase64: string;
    }>;
    expect(requests.length).toBeGreaterThan(0);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          url: '/v1/traces',
          contentType: expect.stringMatching(
            /^application\/(?:json|x-protobuf)(?:;|$)/,
          ),
        }),
      ]),
    );

    const emitted = requests
      .map((request) =>
        Buffer.from(request.bodyBase64, 'base64').toString('utf8'),
      )
      .join('\n');
    for (const allowed of [
      'sanitized-span',
      'trail-sanitized-export',
      'http.request.method',
      'http.response.status_code',
      'http.route',
      '/private/:resourceId',
      'unmatched-route',
    ]) {
      expect(emitted).toContain(allowed);
    }
    for (const sensitive of [
      '7d94c382-1d6b-4f1d-9f7a-3d7bc2b1a411',
      'query-token',
      'query-signature',
      'header-access-token',
      'header-cookie-secret',
      'sensitive-request-id',
      'request-secret',
      'unmatched-path-secret-token',
      'instrumentation-route-secret',
      'instrumentation-path-secret',
      'trail.http.route_template',
      'private-body-value',
      'private-provider-value',
      'db.statement',
      'authorization',
      'cookie',
      'url.path',
      'url.query',
      'url.full',
    ]) {
      expect(emitted).not.toContain(sensitive);
    }
  }, 70_000);
});
