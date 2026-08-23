import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseDocument } from 'yaml';

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const abort = (message) => {
  console.error(message);
  process.exit(1);
};
const parseYaml = (path) => {
  const document = parseDocument(readFileSync(path, 'utf8'), {
    maxAliasCount: 0,
    prettyErrors: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0)
    abort(`${path}: ${document.errors.join('\n')}`);
  return document.toJS({ maxAliasCount: 0 });
};
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

run('docker', ['compose', '-f', 'infra/compose.yaml', 'config', '--quiet']);
for (const script of readdirSync('scripts/ops').filter((name) =>
  name.endsWith('.sh'),
)) {
  if (process.platform !== 'win32')
    run('bash', ['-n', join('scripts/ops', script)]);
}

const doc = parseYaml('infra/koyeb/service.template.yaml');
if (
  !isObject(doc) ||
  Object.keys(doc).some((key) => !['app', 'services'].includes(key))
)
  abort('Koyeb Compose root must contain only app and services');
if (doc.app?.name !== 'trail-beta') abort('Koyeb app.name must be trail-beta');
if (!Array.isArray(doc.services) || doc.services.length !== 1)
  abort('Koyeb Compose must define exactly one API service');
const definition = doc.services[0]?.definition;
const required = [
  'name',
  'type',
  'docker',
  'regions',
  'instance_types',
  'scalings',
  'ports',
  'routes',
  'health_checks',
  'env',
];
if (!isObject(definition) || required.some((key) => !(key in definition)))
  abort('Koyeb service definition is missing required official fields');
if (definition.type !== 'WEB') abort('Koyeb service must be a WEB service');
if (definition.docker?.image !== '<IMMUTABLE_RUNTIME_IMAGE_BY_DIGEST>')
  abort('Koyeb service must use an operator-supplied immutable image digest');
if (
  'git' in definition ||
  JSON.stringify(doc).toLowerCase().includes('deploy.on.push')
)
  abort('Git deployment sources/deploy-on-push are prohibited');
if (JSON.stringify(definition.regions) !== '["<KOYEB_REGION>"]')
  abort('Koyeb region placeholder is required');
if (
  !Array.isArray(definition.instance_types) ||
  definition.instance_types.some(
    (value) =>
      !isObject(value) ||
      !Array.isArray(value.scopes) ||
      typeof value.type !== 'string',
  )
)
  abort('instance_types must use the official scoped list structure');
if (
  !Array.isArray(definition.scalings) ||
  definition.scalings.some(
    (value) =>
      !isObject(value) ||
      !Array.isArray(value.scopes) ||
      !Number.isInteger(value.min) ||
      !Number.isInteger(value.max),
  )
)
  abort('scalings must use the official scoped list structure');
const port = definition.ports?.find((value) => value.port === 3000);
const route = definition.routes?.find(
  (value) => value.path === '/' && value.port === 3000,
);
const health = definition.health_checks?.find(
  (value) => value.http?.path === '/health' && value.http?.port === 3000,
);
if (!port || !route || !health)
  abort('Koyeb port/route/health check structure is invalid');
const environment = Object.fromEntries(
  definition.env.map((value) => [value.key, value.value]),
);
const requiredEnvironment = [
  'DATABASE_URL',
  'MAP_STYLE_URL',
  'OBJECT_STORAGE_ACCESS_KEY',
  'OBJECT_STORAGE_SECRET_KEY',
  'JWT_SIGNING_KEY',
  'EMAIL_OUTBOX_KEY',
  'REFRESH_RECOVERY_KEY',
];
for (const key of requiredEnvironment) {
  if (
    typeof environment[key] !== 'string' ||
    !/^\{\{ secret\.[A-Z0-9_]+ \}\}$/.test(environment[key])
  )
    abort(`${key} must reference a Koyeb secret`);
}
if (parseYaml('infra/koyeb/migration-job.template.yaml') !== null)
  abort('Unsupported Koyeb migration resource must remain absent');

const scanRoots = ['infra', '.github', 'scripts/ops', 'docs/release'];
const rootFiles = ['Dockerfile', 'README.md', 'package.json'];
const files = [];
const collect = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) collect(child);
    else if (entry.isFile()) files.push(child);
  }
};
for (const root of scanRoots) collect(root);
files.push(...rootFiles);
const credentialPattern =
  /postgres(?:ql)?:\/\/[^<\s]+:[^<\s]+@|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/;
for (const path of files) {
  if (
    path.endsWith('compose.yaml') ||
    path.endsWith('validate-config.mjs') ||
    path.endsWith('validate-config.sh')
  )
    continue;
  const content = readFileSync(path, 'utf8');
  if (
    credentialPattern.test(
      content
        .replaceAll('trail_ci_only', '')
        .replaceAll('trail_local_only', ''),
    )
  )
    abort(`Potential credential material found in ${path}`);
}
for (const path of [
  'infra/koyeb/service.template.yaml',
  'infra/koyeb/migration-job.template.yaml',
]) {
  if (
    /value:.*(?:change[-_]?me|example-password|not-a-real-secret)/i.test(
      readFileSync(path, 'utf8'),
    )
  )
    abort(`Unsafe literal placeholder in ${path}`);
}
console.log(
  'Infrastructure templates and operations scripts passed structural validation.',
);
