# Phase 8 controlled beta QA evidence

Phase 8 packages existing functionality; it does not waive earlier gates. Complete each of the eight evidence records below on the exact release candidate. Use synthetic accounts/routes/photos only. Record links to redacted artifacts, not credentials, signed URLs, raw GPS tracks, email addresses, or photo metadata. iOS and Android physical-device evidence is required where listed.

Common header for every record: date/time UTC, tester/operator, commit and image digest, app version/build, API build, provider region, device/model/OS (if applicable), expected result, actual result, pass/fail/blocked, redacted artifact links, issue/approver.

## Evidence 1 — CI, immutable builds, configuration

- CI audit/format/lint/typecheck/tests/build, full practical service tests, migration drift, config/security scan, backup/restore validation.
- Build separate runtime and operator-run migration images from the recorded commit. Inspect non-root runtime and `/health` Docker health check.
- Confirm no CI deployment permissions/provider secrets and no credentials in artifacts/logs.

## Evidence 2 — explicit migration, backup, restore, rollback

- Capture the pre-migration encrypted logical backup and authenticated canonical HMAC manifest covering ciphertext checksum/size, plus approved destination/retention (never key material).
- From a trusted workstation, run the approved immutable migration image by digest once; record exit 0 and schema version. Confirm API startup, CI, and Koyeb did not migrate.
- Restore into a new synthetic database, compare expected rows, and prove an existing target is refused.
- Tabletop API rollback/forward-fix and database secret switch to a validated new restore.

## Evidence 3 — cold start, health, readiness, quotas, alerts

- Allow Koyeb beta to sleep; measure first-request behavior and client retry without losing a local activity.
- Demonstrate `/health` liveness versus `/ready` dependency failure/recovery without sensitive detail.
- Trigger/test non-user-data alerts for readiness, 5xx, backup age, quota, email/deletion/photo backlog. Record no-SLA tester messaging.

## Evidence 4 — authentication, privacy, deletion

- Register/verify/sign in/refresh/sign out/reset with beta Resend and synthetic address; inspect logs/metrics for redaction.
- Verify account isolation and private API/object access. Exercise password-account deletion, DB cascade, object outbox completion and local guarded cleanup.
- Confirm privacy/terms/support/deletion URLs are public HTTPS and store drafts match actual behavior. Record SSO limitations.

## Evidence 5 — iOS physical-device recording and resilience

- On supported iOS, run staged permissions, 20-minute locked-screen recording, pause/resume, process-death recovery, offline save and later idempotent sync.
- Capture distance/time reasonableness, foreground/background indicators, denied/settings states, battery observations, VoiceOver and largest text.
- Link the completed Phase 3–7 evidence needed by this flow.

## Evidence 6 — Android physical-device recording and resilience

- On supported Android, repeat Evidence 5 including Android 13+ notification denial and the location foreground-service notification.
- Confirm OS does not kill or silently truncate the 20-minute locked-screen activity; record OEM battery settings.
- Link the completed Phase 3–7 evidence needed by this flow.

## Evidence 7 — R2 photos and map provider fallback

- With private beta R2, upload three user-selected synthetic JPEG/WebP photos, retry across interruption/process death, download only as owner, delete one, and observe blob deletion. Prove anonymous/cross-account access denied and policy/CORS checklist passes.
- Confirm no EXIF/location metadata, signed URL, or object key leakage. Record HEIC legal disposition.
- Verify OpenFreeMap rendering/attribution/error state, then switch a beta build/config to an owner-provisioned Protomaps HTTPS style (no assets from this repo), verify attribution/rendering, and rollback.

## Evidence 8 — release experience and go/no-go

- On iOS and Android, smoke-test offline routes, activity edit/delete, training totals/calendar across locale/timezone/units, accessibility and empty/error/retry states.
- Validate store reviewer instructions/account, Data safety/privacy nutrition answers, screenshots/metadata, cohort limit and cold-start notice.
- Complete `docs/release/release-checklist.md`; record named approvers and explicit go/no-go. Open provider/legal/device blockers require **no-go**.

## Current status

All eight records: **Not run / blocked pending provider accounts, legal/store ownership, public URLs, exact release candidate, and physical iOS/Android devices.** Automated local validation is necessary but cannot close those external gates.
