# Store review notes and disclosure drafts

**Status: draft, not submission-ready.** Final brand, legal entity, support contact, age rating, store accounts, screenshots, review credentials, regions, and public privacy/terms URLs are external blockers.

## Apple App Review notes draft

Trail is an independent, invite-only outdoor activity recorder. Reviewers can record runs, rides, walks, and hikes offline; background location keeps an active recording running while the screen is locked. Location is collected only after staged permission education and only for recording/user map features. The foreground/background recording UI provides pause/stop controls. User-selected private activity photos use the photo library; camera and microphone are disabled. Accounts support email/password; account deletion is available in-app for password accounts. Social features, ads, subscriptions, HealthKit, tracking, and public activity sharing are not included.

Provide the reviewer with a dedicated synthetic beta account, exact recording steps, a reachable API window that accounts for free-tier cold start, and an explanation of any SSO/deletion limitation. Never place credentials in this repository.

## Google Play review notes draft

Trail's core feature is user-initiated outdoor activity recording. `ACCESS_FINE_LOCATION` provides route/distance, and `ACCESS_BACKGROUND_LOCATION` plus a location foreground service preserves an active recording when the app is backgrounded or locked. Background use is limited to an activity the user explicitly starts and can stop; it is not for ads or passive tracking. Notification permission supports the ongoing recording notification. Photo-library access is user initiated for private activity photos; there is no camera/microphone collection. Include a compliant background-location declaration video and physical-device evidence before submission.

## Apple privacy nutrition draft

Subject to App Store definitions and counsel review:

- **Contact Info — Email Address, Name:** linked to identity; app functionality/account management.
- **Location — Precise Location:** linked to identity; app functionality (recording, route/map/activity review). Background collection occurs during an active recording.
- **User Content — Photos, Other User Content:** linked to identity; app functionality (private photos, titles, notes, route names).
- **Identifiers — User ID:** linked to identity; app functionality/account security.
- **Fitness — Exercise/activity data:** linked to identity; app functionality. Trail does not access Apple Health.
- **Diagnostics/usage:** only privacy-scrubbed operational telemetry if enabled; confirm actual beta configuration before declaring.
- **Tracking:** draft answer **No**; no advertising or cross-company tracking SDK is implemented.

## Google Play Data safety draft

Subject to Play definitions and counsel review:

- Collected: personal info (email/name), precise location, photos, user-provided notes/content, app activity/fitness records, account/security identifiers, and limited diagnostics if enabled.
- Purposes: app functionality, account management, security/fraud prevention, developer communications, and reliability.
- Sharing: service-provider processing by hosting/database/object storage/email/map/approved telemetry providers; assess whether Play categorizes each transfer as “shared.”
- Data encrypted in transit: **Yes** for beta only after TLS configuration is evidenced.
- Deletion request: in-app password-account deletion exists; public request URL and SSO step-up path remain blocked.
- Optionality: photos are optional; precise/background location is required only to record a route but not to inspect already synchronized content. Confirm UI behavior before filing.
- Independent security review: do not claim certification.

## Required URLs — blocked

- Privacy policy URL: **BLOCKED — owner-controlled public HTTPS URL and legal approval required.**
- Terms URL: **BLOCKED — owner-controlled public HTTPS URL and legal approval required.**
- Support URL/contact: **BLOCKED — owner-controlled support channel required.**
- Account deletion web URL (if required by store policy): **BLOCKED — owner/legal implementation decision.**
