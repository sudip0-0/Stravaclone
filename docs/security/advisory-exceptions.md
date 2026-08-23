# Dependency advisory exceptions

This register is the human-readable review record for the exact, machine-enforced exceptions in `advisory-exceptions.json`. `pnpm audit` is never invoked with `--ignore`, and there is no global `auditConfig`. `scripts/security/audit-gate.mjs` executes the real JSON audit and fails for an expired exception, a changed package/version/path/scope/no-fix status, malformed review metadata, or any new advisory.

## Accepted build-only Metro exposure

| Advisory              | Exact finding                                                           | Scope                                                                   | Owner                 | Review / expiry                         | No-fix status                                    |
| --------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------- | --------------------------------------- | ------------------------------------------------ |
| `GHSA-w3rx-r6r6-pgpr` | `image-size@1.2.1` via `apps__mobile>expo>@expo/metro>metro>image-size` | build-only Metro toolchain; audit scopes `all`, `prod`; severity `high` | Mobile platform owner | reviewed 2026-08-23; expires 2026-09-30 | recommendation `None`; patched versions `<0.0.0` |
| `GHSA-5p2g-fcmc-qvqq` | `image-size@1.2.1` via `apps__mobile>expo>@expo/metro>metro>image-size` | build-only Metro toolchain; audit scopes `all`, `prod`; severity `high` | Mobile platform owner | reviewed 2026-08-23; expires 2026-09-30 | recommendation `None`; patched versions `<0.0.0` |

### Rationale and compensating controls

Both advisories are denial-of-service infinite loops in optional image parsers reached through Expo → Metro → `image-size`. Metro is a build tool: it is absent from the production API image and is not called by the installed mobile runtime. Release builds use reviewed repository assets only.

Controls:

- never expose Metro as a production network service;
- run release builds in isolated CI from reviewed repository assets;
- process untrusted user photos only in the API's bounded libheif/sharp pipeline, never through Metro `image-size`;
- inspect Expo/Metro updates on every dependency update and remove these exceptions immediately when a supported fix exists.

## Review procedure

1. Run `pnpm audit:security`; preserve its complete pass/fail summary in release evidence.
2. Confirm the advisory ID, package, installed version, every dependency path, invocation scope, recommendation, and patched-version field still exactly match the JSON register.
3. Reconfirm runtime reachability and each compensating control with the mobile platform owner.
4. Before `review_date`, record the review and update dates only through security review. Never extend `expiry_date` merely to make CI pass.
5. At or after expiry the gate fails closed. Upgrade/remove the dependency, eliminate exposure, or approve a newly reviewed exception with fresh rationale and evidence.
