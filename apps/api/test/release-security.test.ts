import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const read = (relativePath: string) =>
  readFileSync(`${repositoryRoot}/${relativePath}`, 'utf8');
const releaseConfiguration = [
  'Dockerfile',
  '.github/workflows/ci.yml',
  'apps/api/.env.example',
]
  .map(read)
  .join('\n');

describe('release security configuration scan', () => {
  it('runs the CI scanner over repository release source and configuration', () => {
    const scan = spawnSync(
      process.execPath,
      ['scripts/security/release-scan.mjs', '--json'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );
    expect(scan.status, `${scan.stdout}\n${scan.stderr}`).toBe(0);
    const report = JSON.parse(scan.stdout) as {
      scanned_files: string[];
      suppressions_applied: Array<{ file: string; rule: string }>;
      findings: unknown[];
    };
    expect(report.findings).toEqual([]);
    expect(report.scanned_files.length).toBeGreaterThan(200);
    expect(report.scanned_files).toEqual(
      expect.arrayContaining([
        'package.json',
        'apps/api/package.json',
        'apps/mobile/package.json',
        'pnpm-lock.yaml',
        'apps/api/src/db/migrations/0005_phase7_stats.sql',
        'apps/api/src/app.ts',
        'apps/mobile/app.json',
        'apps/mobile/src/config/environment.ts',
        'infra/koyeb/service.template.yaml',
        'scripts/ops/postgres-backup.sh',
        '.github/workflows/ci.yml',
        'docs/release/release-checklist.md',
        'apps/api/test/config.test.ts',
        'scripts/security/release-scan.mjs',
      ]),
    );
    expect(report.suppressions_applied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'apps/api/test/release-security.test.ts',
          rule: 'public object ACL',
        }),
        expect.objectContaining({
          file: 'apps/api/test/config.test.ts',
          rule: 'OSM Foundation tile endpoint',
        }),
      ]),
    );
  });

  it.each([
    [
      'embedded private keys',
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    ],
    ['AWS-style access keys', /AKIA[0-9A-Z]{16}/],
    [
      'public object ACLs',
      /(?:public-read|allow_public|anonymous_get)\s*[:=]?\s*(?:true|1)?/i,
    ],
    [
      'OSM Foundation tiles',
      /https?:\/\/(?:[abc]\.)?tile\.openstreetmap\.org/i,
    ],
    [
      'public demo routing',
      /https?:\/\/(?:router\.project-osrm\.org|routing\.openstreetmap\.de|api\.openrouteservice\.org)/i,
    ],
    [
      'unsafe wildcard CORS',
      /access-control-allow-origin["']?\s*[:=]\s*["']\*/i,
    ],
  ])('contains no %s', (_label, pattern) => {
    expect(releaseConfiguration).not.toMatch(pattern);
  });

  it('keeps telemetry bootstrap free of request bodies and raw location fields', () => {
    const telemetry = [
      read('apps/api/src/telemetry/bootstrap.ts'),
      read('apps/api/src/telemetry/privacy.ts'),
    ].join('\n');
    expect(telemetry).not.toMatch(
      /request\.body|req\.body|latitude|longitude|gps_points|activity_points/i,
    );
  });

  it('does not register permissive CORS middleware in the API', () => {
    const appSource = read('apps/api/src/app.ts');
    expect(appSource).not.toMatch(
      /@fastify\/cors|register\([^)]*cors|origin\s*:\s*true/i,
    );
  });

  it('keeps the example environment explicitly non-production', () => {
    const example = read('apps/api/.env.example');
    expect(example).toMatch(/^NODE_ENV=development$/m);
    expect(example).not.toMatch(/^NODE_ENV=production$/m);
  });
});
