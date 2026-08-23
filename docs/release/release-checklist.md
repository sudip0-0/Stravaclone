# Phase 8 controlled beta release checklist

No checkbox may be inferred from code presence. Attach dated evidence and approver. A failed/blocked item keeps release blocked.

## Ownership and legal

- [ ] Final brand, bundle/application IDs, legal entity, beta regions, age rating, Apple/Google accounts approved.
- [ ] Public HTTPS privacy, terms, support, and required deletion URLs published and wired into store listings/app.
- [ ] Privacy nutrition/Data safety answers reconciled with actual build and provider agreements.
- [ ] OpenFreeMap/OSM attribution and HEIC licensing/patent decision approved; unsupported HEIC removed if not approved.

## Providers and security

- [ ] Beta-only Koyeb/Neon/R2/Resend/accounts, region, quota, terms, MFA, owners, least-privilege access and spend controls approved.
- [ ] R2 private policy/CORS checklist evidenced with synthetic objects; no public object access.
- [ ] TLS, proxy hops, sender DNS, secret references, rotation register, alerts and redaction review evidenced.
- [ ] OpenFreeMap capacity/terms confirmed and provisioned Protomaps fallback URL tested; no public OSM Foundation tiles.

## Build, data, and operations

- [ ] Exact commit/image recorded; CI gates pass; no credentials or deployment occurred from CI.
- [ ] Runtime and separate operator-run migration Docker images build; migration drift/config/security scans pass.
- [ ] Pre-migration encrypted logical backup and authenticated canonical HMAC manifest (covering ciphertext checksum/size) stored at approved encrypted-at-rest destination.
- [ ] Restore into a new database tested with synthetic data; latest daily backup <26 hours and retention/alert owner verified.
- [ ] Trusted operator runs the approved immutable migration image by digest and records exit 0 before the runtime image changes; `/health`, `/ready`, cold-start/retry, registration email, private object ownership/deletion smoke tests pass.
- [ ] Rollback compatibility/forward-fix and provider exit runbooks reviewed in a tabletop exercise.

## Product and device QA

- [ ] Phase 3–7 open physical-device/R2/legal gates are closed; no simulator-only claim substitutes for device evidence.
- [ ] `Phase8QA.md` eight evidence records are complete for supported iOS and Android builds.
- [ ] 20-minute locked-screen recording, process death, offline save/sync, denied permissions, accessibility, locale/timezone/units, and battery evidence accepted.
- [ ] Account/activity/photo deletion and object cleanup observed; SSO limitations accurately disclosed.
- [ ] Store review account contains synthetic data only; reviewer instructions account for Koyeb cold start.

## Go/no-go and aftercare

- [ ] Named release owner, on-call contact, incident channel, maintenance message and beta cohort limit set.
- [ ] No open P0, security/privacy, data-loss, legal, provider, quota, backup, or store blocker.
- [ ] Go decision records timestamp, approvers, commit/image, app builds, migration and evidence links.
- [ ] Post-release health/quota/email/deletion/backup checks assigned for +1h and +24h; rollback trigger and tester communication ready.
