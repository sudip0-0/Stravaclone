import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Providers } from '../src/providers/ports.js';
import { createTestProviders } from '../src/providers/test.js';
import { testConfig } from './fixtures.js';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const matrix = JSON.parse(
  readFileSync(
    `${repositoryRoot}/docs/security/authorization-matrix.json`,
    'utf8',
  ),
) as {
  operations: Array<{
    id: string;
    method: string;
    path: string;
    principal: string;
  }>;
};
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const normalized = (values: string[]) => [...values].sort();

describe('authorization matrix drift gate', () => {
  it('exactly matches every registered versioned Fastify route', async () => {
    const base = createTestProviders();
    const providers = {
      ...base,
      database: { ...base.database, sql: {} },
    } as unknown as Providers;
    const registered: Array<{
      route: string;
      hasPrincipalGuard: boolean;
    }> = [];
    const app = buildApp({
      config: testConfig,
      providers,
      logger: false,
      onRouteRegistered: (route) => {
        const methods = Array.isArray(route.method)
          ? route.method
          : [route.method];
        for (const method of methods) {
          if (route.url.startsWith('/v1/') && method !== 'HEAD') {
            registered.push({
              route: `${method} ${route.url}`,
              hasPrincipalGuard: route.hasPrincipalGuard,
            });
          }
        }
      },
    });
    apps.push(app);
    await app.ready();

    const documented = matrix.operations.map(
      (operation) => `${operation.method} ${operation.path}`,
    );
    expect(new Set(documented).size).toBe(documented.length);
    expect(
      matrix.operations.every(
        (operation) => operation.id && operation.principal,
      ),
    ).toBe(true);
    expect(normalized(registered.map((entry) => entry.route))).toEqual(
      normalized(documented),
    );

    const allowedPrincipals = new Set([
      'access_token',
      'anonymous',
      'refresh_token',
      'reset_token',
    ]);
    expect(
      matrix.operations.every((operation) =>
        allowedPrincipals.has(operation.principal),
      ),
    ).toBe(true);
    for (const operation of matrix.operations) {
      const route = registered.find(
        (entry) => entry.route === `${operation.method} ${operation.path}`,
      );
      expect(route, operation.id).toBeDefined();
      expect(route?.hasPrincipalGuard, operation.id).toBe(
        operation.principal === 'access_token',
      );
      if (!operation.path.startsWith('/v1/auth/')) {
        expect(operation.principal, operation.id).toBe('access_token');
      }
    }
  });

  it('keeps generated documentation consistent with the canonical JSON source', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/security/generate-authorization-docs.mjs', '--check'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
