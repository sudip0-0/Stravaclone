#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const exceptionFile = `${repositoryRoot}/docs/security/advisory-exceptions.json`;
const scope = process.argv.includes('--prod') ? 'prod' : 'all';
const requiredFields = [
  'advisory_id',
  'package',
  'version',
  'paths',
  'audit_scopes',
  'exposure_scope',
  'owner',
  'rationale',
  'compensating_controls',
  'review_date',
  'expiry_date',
  'no_fix_status',
  'expected_severity',
  'expected_recommendation',
  'expected_patched_versions',
];
const stringFields = [
  'advisory_id',
  'package',
  'version',
  'exposure_scope',
  'owner',
  'rationale',
  'review_date',
  'expiry_date',
  'no_fix_status',
  'expected_severity',
  'expected_recommendation',
  'expected_patched_versions',
];
const stringArrayFields = ['paths', 'audit_scopes', 'compensating_controls'];
const allowedSeverities = new Set([
  'info',
  'low',
  'moderate',
  'high',
  'critical',
]);
const allowedAuditScopes = new Set(['all', 'prod']);

function fail(messages) {
  for (const message of messages) console.error(`AUDIT GATE: ${message}`);
  process.exitCode = 1;
}

function normalized(values) {
  return [...values].sort();
}

function sameStrings(left, right) {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  return (
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
}

function validateException(exception, today) {
  const errors = [];
  const id =
    exception && typeof exception === 'object'
      ? (exception.advisory_id ?? '<unknown>')
      : '<unknown>';
  if (!exception || typeof exception !== 'object' || Array.isArray(exception)) {
    return [`${id}: exception must be an object`];
  }
  const keys = Object.keys(exception);
  for (const field of requiredFields) {
    if (!keys.includes(field)) errors.push(`${id}: missing ${field}`);
  }
  for (const field of keys) {
    if (!requiredFields.includes(field))
      errors.push(`${id}: unknown field ${field}`);
  }
  for (const field of stringFields) {
    if (typeof exception[field] !== 'string' || exception[field].length === 0) {
      errors.push(`${id}: ${field} must be a non-empty string`);
    }
  }
  for (const field of stringArrayFields) {
    const value = exception[field];
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((item) => typeof item !== 'string' || item.length === 0) ||
      new Set(value).size !== value.length
    ) {
      errors.push(
        `${id}: ${field} must be a non-empty array of unique strings`,
      );
    }
  }
  if (!/^GHSA-[a-z0-9-]+$/.test(exception.advisory_id ?? '')) {
    errors.push(`${id}: invalid GitHub advisory ID`);
  }
  if (!allowedSeverities.has(exception.expected_severity)) {
    errors.push(`${id}: invalid expected_severity`);
  }
  if (
    Array.isArray(exception.audit_scopes) &&
    exception.audit_scopes.some((value) => !allowedAuditScopes.has(value))
  ) {
    errors.push(`${id}: audit_scopes contains an unsupported scope`);
  }
  for (const field of ['review_date', 'expiry_date']) {
    if (!isIsoDate(exception[field])) errors.push(`${id}: invalid ${field}`);
  }
  if (isIsoDate(exception.review_date) && exception.review_date > today) {
    errors.push(`${id}: review_date ${exception.review_date} is in the future`);
  }
  if (isIsoDate(exception.expiry_date) && exception.expiry_date <= today) {
    errors.push(`${id}: exception expired on ${exception.expiry_date}`);
  }
  if (
    isIsoDate(exception.review_date) &&
    isIsoDate(exception.expiry_date) &&
    exception.review_date > exception.expiry_date
  ) {
    errors.push(`${id}: review_date is after expiry_date`);
  }
  return errors;
}

export function evaluateAuditReport(report, register, auditScope, today) {
  const errors = [];
  if (!register || typeof register !== 'object' || Array.isArray(register)) {
    return ['exception register must be an object'];
  }
  const registerKeys = Object.keys(register);
  for (const field of registerKeys) {
    if (!['schema_version', 'exceptions'].includes(field))
      errors.push(`exception register has unknown field ${field}`);
  }
  if (register.schema_version !== 1)
    errors.push('exception register schema_version must be the number 1');
  if (!Array.isArray(register.exceptions)) {
    errors.push('exception register exceptions must be an array');
    return errors;
  }
  const exceptions = register.exceptions;
  const duplicateIds = exceptions
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => entry.advisory_id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length)
    errors.push(
      `duplicate exception IDs: ${normalized(duplicateIds).join(', ')}`,
    );
  for (const exception of exceptions)
    errors.push(...validateException(exception, today));

  const advisories = Object.values(report.advisories ?? {});
  for (const advisory of advisories) {
    const id = advisory.github_advisory_id;
    const exception = exceptions.find(
      (candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        candidate.advisory_id === id,
    );
    if (!exception) {
      errors.push(
        `${id ?? advisory.id}: new or unreviewed ${advisory.severity} advisory for ${advisory.module_name}`,
      );
      continue;
    }
    if (
      !Array.isArray(exception.audit_scopes) ||
      !exception.audit_scopes.includes(auditScope)
    ) {
      errors.push(`${id}: exception does not permit audit scope ${auditScope}`);
    }
    if (advisory.severity !== exception.expected_severity) {
      errors.push(
        `${id}: severity changed from ${exception.expected_severity} to ${JSON.stringify(advisory.severity)}`,
      );
    }
    if (advisory.module_name !== exception.package) {
      errors.push(
        `${id}: package changed from ${exception.package} to ${advisory.module_name}`,
      );
    }
    if (advisory.recommendation !== exception.expected_recommendation) {
      errors.push(
        `${id}: recommendation changed to ${JSON.stringify(advisory.recommendation)}`,
      );
    }
    if (advisory.patched_versions !== exception.expected_patched_versions) {
      errors.push(
        `${id}: patched versions changed to ${JSON.stringify(advisory.patched_versions)}`,
      );
    }
    const findings = advisory.findings ?? [];
    const versions = [...new Set(findings.map((finding) => finding.version))];
    const paths = findings.flatMap((finding) => finding.paths ?? []);
    if (!sameStrings(versions, [exception.version])) {
      errors.push(
        `${id}: installed versions changed to ${versions.join(', ')}`,
      );
    }
    if (!sameStrings(paths, exception.paths)) {
      errors.push(
        `${id}: dependency paths changed to ${normalized(paths).join(', ')}`,
      );
    }
  }

  const reportedIds = new Set(
    advisories.map((advisory) => advisory.github_advisory_id),
  );
  const stale = exceptions.filter(
    (exception) =>
      exception &&
      typeof exception === 'object' &&
      Array.isArray(exception.audit_scopes) &&
      exception.audit_scopes.includes(auditScope) &&
      !reportedIds.has(exception.advisory_id),
  );
  if (stale.length) {
    errors.push(
      `remove stale exception(s), no longer reported: ${stale.map((entry) => entry.advisory_id).join(', ')}`,
    );
  }
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const register = JSON.parse(readFileSync(exceptionFile, 'utf8'));
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const args = ['audit', '--json'];
  if (scope === 'prod') args.push('--prod');
  console.log(
    `Running transparent dependency audit (${scope} scope): pnpm ${args.join(' ')}`,
  );
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (result.error) {
    fail([`could not execute pnpm audit: ${result.error.message}`]);
  } else {
    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch {
      fail([
        `pnpm audit did not return JSON (exit ${result.status}): ${result.stderr.trim() || 'no diagnostic'}`,
      ]);
    }
    if (report) {
      const today = new Date().toISOString().slice(0, 10);
      const errors = evaluateAuditReport(report, register, scope, today);
      if (errors.length) fail(errors);
      else {
        const ids = Object.values(report.advisories ?? {}).map(
          (item) => item.github_advisory_id,
        );
        console.log(
          `Audit gate passed: ${ids.length} exact reviewed advisory finding(s): ${ids.join(', ') || 'none'}.`,
        );
      }
    }
  }
}
