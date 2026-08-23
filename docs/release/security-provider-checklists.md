# Provider security and credential checklists

## Cloudflare R2 private bucket and CORS

- [ ] Beta-only bucket; public access, `r2.dev`, website access, and anonymous policy disabled.
- [ ] Application key scoped only to required object read/write/delete/list actions on that bucket; account-admin key not used by the API.
- [ ] Object keys remain owner-prefixed and opaque; signed URLs are short-lived and never logged.
- [ ] Server-side encryption at rest confirmed in provider terms/settings; TLS-only endpoint configured.
- [ ] CORS absent by default. If direct mobile presigned POST requires it, allow only exact required methods (`POST`, and only required `HEAD`/`GET`), headers, and short max-age. Do not use `*` origins with credentials. Native apps do not make browser CORS an authorization boundary.
- [ ] Presigned policy constrains bucket/key, exact declared content length, and MIME; API verifies `HEAD` before completion.
- [ ] Lifecycle rules do not delete normalized live objects; stale staging lifecycle matches product cleanup timing.
- [ ] Access/error/storage/egress quotas and deletion backlog alerts configured and tested.
- [ ] Cross-account/private-object restore or provider-exit copy tested with synthetic objects.

## Rotation procedure

Maintain an owner/access register and rotation date. Never paste values into tickets, logs, docs, shell history, or GitHub variables unless that system is the approved secret store.

1. Create a new least-privilege credential/key in the provider and secret manager.
2. For R2/SMTP/database credentials, deploy the new reference, smoke-test, then revoke the old credential. For the three application cryptographic keys, use application-supported overlap/re-encryption semantics; absent such support, rotation is a planned session invalidation/outbox drain event, not a blind replacement.
3. JWT signing-key replacement invalidates existing access tokens unless a multi-key verifier exists. Refresh recovery-key replacement can invalidate replay recovery bundles. Email outbox-key replacement can strand pending encrypted messages: drain/cancel safely first.
4. Verify `/ready`, auth, private object access, email, and redacted telemetry. Revoke old material and record completion without values.
5. On suspected compromise: pause affected capability, revoke first when risk demands it, rotate related credentials, invalidate sessions, inspect provider audit events, and communicate impact.

Suggested maximum rotation intervals for beta (owner must approve): provider access keys/SMTP/database password 90 days; application crypto keys 180 days or on incident/personnel change. Rotate immediately after accidental disclosure.

## Secret and access baseline

- [ ] Separate beta provider accounts/projects/roles and GitHub environment; least privilege and MFA for humans.
- [ ] No credentials in repository, mobile `EXPO_PUBLIC_*`, Docker image layers, CI logs, manifests, or support exports.
- [ ] GitHub Actions has `contents: read`, no deployment permissions, and no provider secrets.
- [ ] Neon URL requires TLS (`sslmode=require`); pooled runtime and migration/admin access are intentionally separated where available.
- [ ] Resend sender domain is verified; SPF/DKIM/DMARC and bounce monitoring are configured.
- [ ] Koyeb proxy hop count is verified, custom beta hostname uses TLS, and service is not advertised publicly.
- [ ] Privacy/terms URLs remain a release blocker until owner-hosted HTTPS pages are approved and published.
