import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAuditReport } from './audit-gate.mjs';

const exception = {
  advisory_id: 'GHSA-aaaa-bbbb-cccc',
  package: 'build-parser',
  version: '1.2.3',
  paths: ['mobile>metro>build-parser'],
  audit_scopes: ['all'],
  exposure_scope: 'build-only Metro toolchain',
  owner: 'Mobile platform owner',
  rationale: 'Not runtime reachable',
  compensating_controls: ['Isolated trusted builds'],
  review_date: '2026-08-23',
  expiry_date: '2026-09-30',
  no_fix_status: 'No upstream fix',
  expected_severity: 'high',
  expected_recommendation: 'None',
  expected_patched_versions: '<0.0.0',
};
const advisory = {
  github_advisory_id: exception.advisory_id,
  severity: 'high',
  module_name: exception.package,
  recommendation: exception.expected_recommendation,
  patched_versions: exception.expected_patched_versions,
  findings: [{ version: exception.version, paths: exception.paths }],
};
const report = { advisories: { 1: advisory } };
const register = { schema_version: 1, exceptions: [exception] };

test('accepts only an exact active reviewed finding', () => {
  assert.deepEqual(
    evaluateAuditReport(report, register, 'all', '2026-08-23'),
    [],
  );
});

test('fails closed for expiry, changed paths, and new advisories', () => {
  assert.ok(
    evaluateAuditReport(report, register, 'all', '2026-09-30').some((error) =>
      error.includes('expired'),
    ),
  );
  const changed = structuredClone(report);
  changed.advisories['1'].findings[0].paths = ['mobile>different>build-parser'];
  assert.ok(
    evaluateAuditReport(changed, register, 'all', '2026-08-23').some((error) =>
      error.includes('paths changed'),
    ),
  );
  const added = structuredClone(report);
  added.advisories['2'] = {
    ...advisory,
    github_advisory_id: 'GHSA-new1-new2-new3',
  };
  assert.ok(
    evaluateAuditReport(added, register, 'all', '2026-08-23').some((error) =>
      error.includes('unreviewed'),
    ),
  );
});

test('rejects a future review date and non-exact schema types', () => {
  const future = structuredClone(register);
  future.exceptions[0].review_date = '2026-08-24';
  assert.ok(
    evaluateAuditReport(report, future, 'all', '2026-08-23').some((error) =>
      error.includes('in the future'),
    ),
  );

  const wrongTypes = structuredClone(register);
  wrongTypes.schema_version = '1';
  wrongTypes.exceptions[0].paths = 'mobile>metro>build-parser';
  const errors = evaluateAuditReport(report, wrongTypes, 'all', '2026-08-23');
  assert.ok(errors.some((error) => error.includes('number 1')));
  assert.ok(errors.some((error) => error.includes('paths must be')));
});

test('rejects changed severity, version, and audit scope', () => {
  const changedSeverity = structuredClone(report);
  changedSeverity.advisories['1'].severity = 'critical';
  assert.ok(
    evaluateAuditReport(changedSeverity, register, 'all', '2026-08-23').some(
      (error) => error.includes('severity changed'),
    ),
  );

  const changedVersion = structuredClone(report);
  changedVersion.advisories['1'].findings[0].version = '1.2.4';
  assert.ok(
    evaluateAuditReport(changedVersion, register, 'all', '2026-08-23').some(
      (error) => error.includes('versions changed'),
    ),
  );

  assert.ok(
    evaluateAuditReport(report, register, 'prod', '2026-08-23').some((error) =>
      error.includes('does not permit audit scope'),
    ),
  );
});
