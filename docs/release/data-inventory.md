# Trail beta data inventory

Draft based on the implemented schema and mobile configuration in the local Phase 8 hardening baseline. Legal/privacy owners must verify retention and provider contracts before publication.

<!-- prettier-ignore -->
| Data | Purpose | Location/processors | Notes |
|---|---|---|---|
| Email, password hash, display name, optional avatar URL, units/default sport | Account, authentication, profile | Mobile secure/local storage as applicable; Koyeb API; Neon | Password itself is not stored server-side. Registration/reset records and hashed tokens are temporary operational data. |
| Provider identity subject (Apple/Google when enabled) | Account sign-in/linking | Koyeb/Neon and identity provider | SSO HTTP routes are currently disabled; do not claim collection until enabled. |
| Access/refresh session data, device hint, auth/security metadata | Authentication, fraud/session safety | SecureStore; Koyeb/Neon | Includes hashed tokens, encrypted recovery bundle, expiry/revocation timestamps. |
| Precise/background location, timestamps, accuracy, optional elevation, pauses, polylines/routes | Record, synchronize, map, and calculate private activities | Device SQLCipher; Koyeb; Neon; configured map style/tile provider receives IP address, requested tile/viewport, and ordinary network request metadata | Precise location is sensitive. Recording can continue in background. Raw coordinates/tracks must not enter logs/telemetry. |
| Sport, title, notes, time, distance, moving/elapsed time, elevation, splits, stats/calendar | Activity review and training totals | Device; Koyeb; Neon | User-entered notes may contain sensitive text. |
| User-selected photos and derived JPEG/WebP, dimensions, status, optional explicit track-derived/capture association | Private activity photos | Device; Koyeb processing; private R2; metadata rows in Neon | No camera/microphone permission. The app states photo location metadata is not read; EXIF is stripped. HEIC is release-blocked pending legal review. |
| Raw route waypoints/polyline/name and sync tombstones | User-created offline route planning | Device; Koyeb; Neon | No external routing provider in v1. |
| Email delivery payload/status, bounce/rejection operational data | Verify account, reset password, service email | Encrypted outbox in Neon; Koyeb; Resend SMTP | Recipient and message content must not be telemetry labels/logged. |
| Aggregated service logs/metrics | Security, reliability, quota/backup operations | Koyeb/provider dashboards; optional approved OTLP collector | Must exclude emails, tokens, signed URLs, raw GPS, notes, object keys, photo/media metadata. OTEL defaults off. |
| Local diagnostics (planned) | User support | Device/user-chosen export | Privacy-safe diagnostic export is not implemented; do not claim collection/upload. |

## Retention and deletion draft

- Canonical activities and filtered points are retained until the user deletes the activity/account; v1 intentionally retains filtered points.
- Private photo objects are deleted through an idempotent outbox after photo/activity/account deletion. Operators monitor backlog; provider backups may retain deleted records for their configured backup window.
- Refresh tokens expire/revoke; registration/password reset and email outbox records have operational lifecycle fields. Exact purge periods require owner/legal approval.
- Local drafts/pending sync survive offline/process death. Recoverable non-pending drafts are retained at least 24 hours and abandoned non-pending drafts are targeted for purge after 30 days; account-deletion intent has separate guarded behavior.
- Logical beta backups target daily execution and default script retention is 14 days, but actual schedule/destination/provider retention must be configured and disclosed.
- Account deletion with password proof cascades database records and queues object cleanup. SSO-only step-up remains blocked; deletion completion and backup expiry must not be overstated.

## Sharing/sale/tracking draft

Trail does not implement advertising, a social feed, third-party analytics tracking, contacts, health-platform integration, wearable integration, or sale of personal data. Service providers process data to operate the beta. The configured map provider receives IP address, requested tile/viewport, and normal request metadata; email/cloud providers may receive IP address and normal request metadata under their terms. This inventory is not legal advice and must be reconciled with executed provider agreements and store definitions.
