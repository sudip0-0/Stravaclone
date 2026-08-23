#!/usr/bin/env node
import { isUtf8 } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const git = spawnSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    encoding: 'utf8',
  },
);
if (git.status !== 0) {
  console.error(
    `RELEASE SCAN: cannot enumerate repository files: ${git.stderr}`,
  );
  process.exit(1);
}

// Scan every Git-enumerated UTF-8 text file by default. This deliberately includes
// manifests, pnpm-lock.yaml, migrations, application source/config, infra/koyeb,
// scripts, workflows, tests, and documentation. Only actual binary/non-UTF-8 files
// are omitted; generated outputs are already excluded by Git ignore rules.
const files = [];
const sources = new Map();
for (const path of git.stdout.split('\0').filter(Boolean)) {
  try {
    const bytes = readFileSync(`${root}/${path}`);
    if (bytes.includes(0) || !isUtf8(bytes)) continue;
    files.push(path);
    sources.set(path, bytes.toString('utf8'));
  } catch (error) {
    sources.set(path, error);
    files.push(path);
  }
}

const rules = [
  [
    'private key material',
    /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gi,
  ],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  [
    'GitHub token',
    /\b(?:gh[oprsu]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  ],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  [
    'hard-coded bearer token',
    /authorization\s*[:=]\s*["'`]Bearer\s+[A-Za-z0-9._~-]{20,}["'`]/gi,
  ],
  [
    'credential in provider URL',
    /(?:postgres(?:ql)?|redis|smtp|https?):\/\/[^\s/:@"']+:[^\s/@"']+@[^\s/"']+/gi,
  ],
  [
    'public object ACL',
    /\b(?:public-read|anonymous_get|allow_public)\b\s*[:=]?\s*(?:true|1)?/gi,
  ],
  [
    'OSM Foundation tile endpoint',
    /https?:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\b/gi,
  ],
  [
    'public demo routing endpoint',
    /https?:\/\/(?:router\.project-osrm\.org|routing\.openstreetmap\.de|api\.openrouteservice\.org)\b/gi,
  ],
  [
    'wildcard CORS header',
    /access-control-allow-origin["']?\s*[:=]\s*["']\*["']/gi,
  ],
  ['permissive CORS origin', /\borigin\s*:\s*(?:true|["']\*["'])/gi],
];

// Narrow, code-reviewed known-literal fixtures. Each suppression names one file and
// one rule; no test/docs/source directory is excluded wholesale.
const literalSuppressions = [
  {
    path: 'apps/api/test/release-security.test.ts',
    rule: 'public object ACL',
    reason:
      'negative assertions intentionally enumerate prohibited ACL literals',
  },
  {
    path: 'scripts/security/release-scan.mjs',
    rule: 'public object ACL',
    reason: 'the scanner rule definition necessarily contains its own literals',
  },
  {
    path: 'apps/api/test/config.test.ts',
    rule: 'credential in provider URL',
    reason: 'synthetic provider.invalid database configuration fixture',
  },
  {
    path: 'apps/api/test/config.test.ts',
    rule: 'OSM Foundation tile endpoint',
    reason:
      'negative configuration validation fixture for a prohibited endpoint',
  },
  {
    path: 'apps/api/test/fixtures.ts',
    rule: 'credential in provider URL',
    reason: 'local integration database fixture with non-provider credentials',
  },
  {
    path: 'README.md',
    rule: 'credential in provider URL',
    reason: 'documented loopback-only bootstrap database example',
  },
];

function documentedSuppression(rule, match, path) {
  const literal = literalSuppressions.find(
    (entry) => entry.path === path && entry.rule === rule,
  );
  if (literal) return literal.reason;
  if (
    rule !== 'credential in provider URL' ||
    !(path === '.github/workflows/ci.yml' || path.endsWith('/.env.example'))
  )
    return undefined;
  try {
    const host = new URL(match).hostname;
    if (host === '127.0.0.1' || host === 'localhost')
      return 'documented local-only workflow/environment example';
  } catch {
    // Malformed URLs are findings, never suppressions.
  }
  return undefined;
}

const findings = [];
const suppressionsApplied = [];
for (const path of files) {
  const source = sources.get(path);
  if (source instanceof Error) {
    findings.push({
      file: path,
      line: 0,
      rule: 'unreadable release file',
      match: source.message,
    });
    continue;
  }
  for (const [rule, expression] of rules) {
    expression.lastIndex = 0;
    for (const match of source.matchAll(expression)) {
      const suppression = documentedSuppression(rule, match[0], path);
      if (suppression) {
        suppressionsApplied.push({ file: path, rule, reason: suppression });
        continue;
      }
      const line = source.slice(0, match.index).split('\n').length;
      findings.push({
        file: path,
        line,
        rule,
        match: match[0].replace(/[^:@/]{4,}(?=@)/g, '[REDACTED]'),
      });
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        scanned_files: files,
        suppressions_applied: suppressionsApplied,
        findings,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `Release security scan inspected ${files.length} repository release files.`,
  );
  for (const finding of findings)
    console.error(
      `${finding.file}:${finding.line}: ${finding.rule}: ${finding.match}`,
    );
}
if (findings.length) process.exitCode = 1;
