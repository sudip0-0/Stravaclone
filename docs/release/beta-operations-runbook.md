# Controlled beta operations runbook

This is an isolated, invite-only beta posture, not a production/SLA claim. No provider account is configured by this repository. Provider region, owner, terms, quota, billing guardrails, legal identity, and secrets manager remain external decisions.

## Release and migration order

1. Freeze an exact commit/tag; pass CI and Phase 8 evidence review.
2. Confirm Neon and R2 backups, quota headroom, provider status, and rollback image digest/tag.
3. Run `scripts/ops/postgres-backup.sh`; copy the encrypted dump and authenticated canonical HMAC manifest to the owner-selected encrypted-at-rest destination. Verify a recent restore drill.
4. From a trusted operator workstation, pull the separately approved immutable migration image by digest and run it exactly as documented in `infra/README.md`. Capture exit code and redacted logs. **API startup never migrates; CI and Koyeb never run this operator step.**
5. Only after the operator-run migration image exits 0, substitute the separately approved runtime image digest in the Koyeb Compose template and invoke the deployment manually. Koyeb does not order these steps; this repository and CI never deploy and no deploy-on-push source is configured.
6. Check `/health` for process liveness and `/ready` for bounded dependency readiness. Smoke-test registration email, sign-in, one synthetic activity, private photo access, and deletion.
7. Roll out only to the beta cohort. Record operator, timestamp, commit/image, migration, checks, and decision.

## Isolation and quotas

- Use beta-only Koyeb service, Neon project/database/role, R2 bucket and scoped keys, Resend domain/key, JWT/encryption keys, telemetry dataset, and mobile API URL. Never share production credentials or data.
- Deny public R2 access. Keep test accounts synthetic. Do not upload real GPS tracks or photos during operational checks.
- Record provider quota limits from the account dashboard; alert at 70%, 85%, and 95% where supported. At 85%, pause invitations and high-volume photo tests. At 95%, disable new beta signups/uploads before surprise charges or data loss.
- Free services can suspend, sleep, change quotas, or be reclaimed. Keep exports provider-neutral and rehearse exits.

## Cold start, no SLA, and incident communication

Koyeb free compute may scale to zero. A first request can be slow or fail while waking. The client must retain local recordings and retry; operators must not present `/health` success as dependency readiness. There is no uptime, latency, durability, email-delivery, map-availability, or recovery-time SLA for beta. Communicate maintenance and provider incidents to invited testers out-of-band.

## Metrics and alerts

Never include raw coordinates, polylines, notes, email addresses, tokens, signed URLs, object keys, or photo metadata. Monitor aggregated:

- `/health` and `/ready` success/latency; 5xx/429 rate and request latency by route template.
- process restarts, memory/CPU, Koyeb cold starts and quota.
- Neon connections/storage/compute quota, slow/error counts, migration failures.
- R2 request/error/storage/egress quota and deletion-outbox age/count.
- Resend delivery/bounce/rejection and email-outbox pending age/count (no recipient address labels).
- photo processing pending/failed age/count; backup age/result; restore-drill result.

Page/notify for readiness failure >5 minutes, sustained 5xx, backup older than 26 hours, migration failure, storage or DB quota >=85%, deletion backlog growth, or credential misuse alerts. `OTEL_ENABLED=false` remains default until a nonlocal HTTPS collector and redaction review are approved.

## Rollback

1. Stop invitations and writes if integrity is at risk; preserve mobile offline data.
2. Roll API back to the last known image/commit only when its code is compatible with the migrated schema. Never reverse a destructive migration ad hoc.
3. If the schema is incompatible, deploy a forward-fix migration. Restoring data is a disaster-recovery decision: restore into a **new** database, validate counts/ownership, then explicitly switch `DATABASE_URL`; never overwrite Neon in place.
4. Rotate potentially exposed keys, invalidate sessions when JWT/recovery scope requires it, verify object privacy and email, then reopen gradually.
5. Record timeline, impact, decision, evidence, and follow-up.

## Provider exits and fallbacks

### Koyeb

Build the same root Docker `runtime` image on any Node 22-compatible container platform. Preserve port 3000, TLS proxy assumptions, `/health`, `/ready`, all environment validation, and separate migration execution. Validate `TRUST_PROXY_HOPS` for the replacement before traffic.

### Neon

Take an encrypted logical backup plus its authenticated canonical HMAC manifest, which covers the ciphertext checksum and size. Provision a new TLS Postgres 17-compatible database, restore only into a new database, run integrity/smoke checks, update the beta secret, and retain the old database read-only until sign-off. Provider point-in-time recovery is not a substitute for the logical export.

### R2

Inventory database-referenced object keys and copy private objects with an S3-compatible tool using least-privilege temporary credentials. Verify object count/bytes/checksums, bucket privacy, signed upload/download behavior, and deletion worker before switching endpoint/bucket secrets. Do not make objects public during transfer.

### Resend

Verify a replacement SMTP provider/domain, SPF/DKIM/DMARC, TLS, sender, bounce handling, and quotas. Rotate SMTP credentials, update provider fields, and test with a beta-only recipient. Queued encrypted outbox payloads must remain decryptable during the switch.

### OpenFreeMap to Protomaps

This is a provider configuration change, **not a live runtime switch**, and no tile assets are included here. Before switching, the owner must provision/license/host a Protomaps-compatible HTTPS style and tiles, confirm capacity/CORS and required attribution, and test MapLibre on iOS/Android. Set Koyeb secret `TRAIL_BETA_MAP_STYLE_URL` for API `MAP_STYLE_URL`; set Expo build-time `EXPO_PUBLIC_MAP_STYLE_URL`, `EXPO_PUBLIC_MAP_PROVIDER_NAME`, and `EXPO_PUBLIC_MAP_PROVIDER_URL` to the approved style and provider disclosure. Rebuild, test, and release the iOS/Android app because Expo embeds all `EXPO_PUBLIC_*` values in the bundle. Verify that configured provider disclosure and OpenStreetMap attribution are both visible, plus offline/error behavior and rendering, before gradual rollout. Rollback likewise requires rebuilding/re-releasing with all three previous approved values (or rolling back to an already-tested build); changing a server secret cannot change an installed mobile bundle. Never point distributed builds at OpenStreetMap Foundation public tile hosts, and never put map credentials or signed query values in these public build variables.
