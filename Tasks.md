# Trail v1 Delivery Plan

**Status:** Phase 1 local implementation complete; Phase 0 external decisions remain
**Legend:** `[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked  
**Priority:** P0 ship blocker · P1 expected for v1 unless explicitly cut · P2 optional

## How to use this plan

Work in phase order unless a dependency is explicitly resolved another way. A task is complete only when code, tests, accessibility, failure states, and relevant documentation are complete. Every implementation PR should cite the task and PRD requirement IDs. Do not mark real-device gates complete from simulator testing.

### Cross-cutting definition of done

- Acceptance criteria for linked PRD IDs pass.
- Unit/integration tests cover happy path, invalid input, offline/retry behavior, and ownership where relevant.
- Typecheck, lint, tests, and production builds pass.
- No secrets, tokens, signed URLs, raw GPS tracks, or photo metadata appear in logs.
- UI supports loading, empty, offline, denied-permission, retry, and destructive-confirmation states.
- VoiceOver/TalkBack labels and reasonable dynamic type behavior are verified.
- API/schema changes include migrations and backward compatibility notes.
- Product, architecture, and task documents are updated when a decision changes.

## Phase 0 — Decisions and project foundation

### 0.1 Product and provider decisions

- [x] **P0** Record development identity: slug `trail`, temporary iOS/Android IDs `com.trailapp.mobile`.
- [!] **P0** Confirm final brand, bundle/application IDs, domains, legal owner, and paid Apple/Google store accounts. (`Q1`; external)
- [x] **P0** Select Node 22, pnpm workspaces, Expo SDK 57/Expo-selected React Native, Fastify, Zod, Drizzle/Postgres, Vitest, ESLint, and Prettier.
- [x] **P0** Select local Docker services: Postgres 17, MinIO, and Mailpit.
- [x] **P0** Select free-beta providers: Koyeb free API, Neon free Postgres, private Cloudflare R2, and Resend free SMTP; record Koyeb no-SLA/scale-to-zero constraint.
- [ ] **P0** Select beta region, create provider accounts, validate quotas/terms, and choose secrets management.
- [x] **P0** Select OpenFreeMap public instance for development/beta with visible attribution and self-hosted Protomaps fallback. (`A3`, `Q9`, `SET-2`)
- [x] **P1** Defer snap-to-roads from v1; do not use a public demo routing API. (`RTE-2`, `Q2`)
- [x] **P0** Select smoothed GPS elevation fallback for v1 and a later self-hosted OpenTopoData adapter. (`ACT-5`)
- [x] **P0** Set 15-minute access/30-day rotating refresh family with reuse detection; photo maximum 10 at 10 MB input each; activity maximum 100,000 filtered points; retain filtered points in v1.
- [x] **P0** Set daily database backup target and require a documented restore, explicitly subject to hosted free-tier limitations.
- [ ] **P0** Write the Apple/Google account-linking policy. (`AUTH-2`, `AUTH-3`, risk SSO collision)

**Exit:** Decisions are recorded in `Architecture.md`; provider accounts/terms support the controlled beta; external identity blockers are visible. Checked decisions do **not** imply that bootstrap or provider configuration has started.

### 0.2 Monorepo bootstrap

- [x] **P0** Create pnpm workspaces for `apps/mobile`, `apps/api`, `packages/contracts`, `packages/domain`, `packages/config`, and `infra` on Node 22.
- [x] **P0** Bootstrap Expo SDK 57 with Expo-compatible React Native and a Fastify API.
- [x] **P0** Add strict TypeScript, ESLint, Prettier, Vitest, typecheck, and build scripts.
- [x] **P0** Add Zod environment validation and checked-in `.env.example` files with no credentials.
- [x] **P0** Add CI for install, format check, lint, typecheck, unit/integration tests, and builds.
- [x] **P0** Add Docker Compose for Postgres 17, MinIO, and Mailpit plus the Drizzle migration workflow.
- [x] **P0** Add API health/readiness, request IDs, structured redacted logging, OpenTelemetry, error envelope, and optional scrubbed Sentry/GlitchTip adapter.
- [x] **P1** Add dependency/security scanning and automated update policy.

**Exit:** A clean checkout can run documented setup, tests, and builds; CI enforces them.

## Phase 1 — Contracts, domain, and data

### 1.1 Shared contracts

- [x] **P0** Define schemas/types for sports, units, auth, users, activities, points, splits, routes, photos, stats, pagination, and errors.
- [x] **P0** Establish API versioning under `/v1`, compatibility rules, cursor pagination, and stable error codes.
- [x] **P0** Add contract fixtures and tests for valid/invalid payloads.

### 1.2 Pure activity domain

- [x] **P0** Implement coordinate/time validation and accuracy classification. (`REC-3`, `NFR-GPS`)
- [x] **P0** Implement sport-specific impossible-jump filtering and geodesic segment distance. (`NFR-GPS`)
- [x] **P0** Implement elapsed/moving time with pause intervals. (`REC-1`, `ACT-2`)
- [x] **P0** Implement metric/imperial split generation including final partial split. (`ACT-4`, `PROF-2`)
- [x] **P0** Implement pace/speed and unit conversion/formatting boundaries. (`ACT-2`, `PROF-2`)
- [x] **P0** Implement elevation smoothing/gain fallback and provider-independent enrichment types. (`ACT-5`)
- [x] **P0** Implement overview polyline encoding and display downsampling. (`ACT-3`, performance NFR)
- [x] **P0** Add deterministic fixture tests for urban noise, poor fixes, pauses, gaps, rides, and unit changes.

### 1.3 Database

- [x] **P0** Migrate users, identities, refresh tokens, activities, activity points, splits/elevation, routes, and photos. (`PRD §9`)
- [x] **P0** Add constraints, owner/date indexes, idempotency uniqueness, and migration tests. (Request replay/conflict semantics remain deferred to Phase 4.)
- [x] **P0** Add object-deletion/outbox records for reliable photo/account cleanup.
- [x] **P0** Add seed/factory utilities using synthetic tracks only.

**Exit:** Domain calculations are deterministic; schema supports all MUST entities and owner isolation.

## Phase 2 — Authentication, profile, and app shell

### 2.1 API authentication

- [x] **P0** Non-enumerating email-verified registration (`202` request + one-use confirmation), normalized unique email, password policy, Argon2id, and private login errors. (`AUTH-1`)
- [x] **P0** Versioned short-lived access JWTs and rotating hashed refresh families with durable encrypted same-request successor recovery until successor consumption/expiry/revocation. (`AUTH-4`)
- [x] **P0** Idempotent family logout revocation, one-time auth-version invalidation, and replay tests. (`AUTH-5`)
- [ ] **P0 BLOCKED — external/native security flow** Sign in with Apple has no API route. Verifier interfaces exist, but server-owned one-use state/nonce/PKCE, native callback setup, and real provider/device proof are required. (`AUTH-2`)
- [ ] **P0 BLOCKED — external/native security flow** Google sign-in has no API route. Verifier interfaces exist, but server-owned one-use state/nonce/PKCE, native callback setup, and real provider/device proof are required. (`AUTH-3`)
- [ ] **P0 BLOCKED — step-up design** Provider linking has no API route and must require recent step-up before permanent identity attachment.
- [x] **P0** Layer validated-IP and normalized identity/token/user auth limits, bound global/endpoint Argon2 queues, and add random-identifier abuse tests. (`NFR security`)
- [x] **P1** Password reset with expiring one-use token and non-enumerating response. (`AUTH-6`)

### 2.2 User/profile API

- [x] **P0** Implement `GET/PATCH /v1/me`, profile validation, units, and default sport. (`PROF-1`, `PROF-2`)
- [x] **P1** Implement confirmed password-account deletion with current-password proof, DB cascade, and queued blob cleanup. SSO-only deletion remains blocked pending provider step-up. (`PROF-3`)

### 2.3 Mobile shell

- [x] **P0** Sign-up uses non-enumerating `202` accepted registration followed by pasteable email verification token confirmation; secure session creation occurs only after successful confirmation, while welcome/sign-in/session/sign-out flows remain available.
- [x] **P0** Store refresh/access credentials only in platform secure storage.
- [x] **P0** Coordinated refresh securely persists and reuses stable `rotation_request_id`, replays once, retains credentials for retryable network/429/5xx failures, and returns to sign-in only on terminal auth failure.
- [x] **P0** Add Record, Activity, Routes, and You tab/stack navigation. (`NAV-1`)
- [x] **P0** Profile/settings collect current-password deletion proof, surface `step_up_required` for SSO-only accounts and `403 step_up_failed` for wrong password, use paste-token reset, and keep SSO/link controls informational and non-routable while retaining units/legal/attribution. (`SET-1`, `SET-2`)
- [x] **P0** Ensure sign-out does not silently discard an active or unsynced draft. The Phase 2 guard consumes the recording/sync reporter interface and never mutates draft data; Phase 3 must connect its durable reporter. (`AUTH-5`)
- [ ] **P1** Add app version and privacy-safe recording diagnostic export. (`SET-3`)

**Exit:** All auth methods work on target platforms, session rotation survives cold start, and profile units apply globally.

## Phase 3 — Reliable GPS recording

### 3.1 Local state and services

- [ ] **P0** Add mobile SQLite schema/migrations for recording sessions, points, sync jobs, and pending photos.
- [ ] **P0** Implement Idle → Starting → Recording ⇄ Paused → Stopping → Saving lifecycle. (`REC-1`)
- [ ] **P0** Allocate stable client UUID and persist session metadata before location collection.
- [ ] **P0** Checkpoint accepted points at least every five seconds or batch threshold. (`REC-7`)
- [ ] **P0** Restore after process death and present Resume/Discard without losing buffered points. (`REC-7`, recovery journey)
- [ ] **P0** Enforce 12-hour stop and save threshold of 30 seconds or 50 metres. (`REC-14`, `Q8`)
- [ ] **P0** Make discard confirmed, local-only, and complete. (`REC-9`)

### 3.2 Permissions and background execution

- [ ] **P0** Implement staged When In Use/background location education and denial/settings states. (`REC-13`)
- [ ] **P0** Configure iOS background location and exact purpose strings. (`REC-4`, PRD §12)
- [ ] **P0** Configure Android location foreground service and persistent elapsed/distance notification. (`REC-4`)
- [ ] **P0** Handle Android 13+ notification permission and degraded/warning behavior.
- [ ] **P1** Add OEM battery optimization guidance without blocking recording. (`REC-10`)

### 3.3 Record UI

- [ ] **P0** Implement pre-start sport selector for run/ride/walk/hike. (`REC-2`)
- [ ] **P0** Implement GPS quality state using icon/text plus accuracy value. (`REC-5`, accessibility)
- [ ] **P0** Implement elapsed time, distance, current pace/speed HUD. (`REC-5`)
- [ ] **P0** Implement MapLibre live map, in-progress polyline, location puck, and follow toggle. (`REC-6`)
- [ ] **P0** Preserve visible attribution and accessible controls at supported text sizes. (`SET-2`, accessibility)
- [ ] **P0** Implement stop confirmation and save/discard sheet.

### 3.4 Device verification

- [ ] **P0** Locked-screen 20-minute activity on current/previous iOS target devices. (`REC-4`)
- [ ] **P0** Locked-screen 20-minute activity on representative Android API 26+ and current device.
- [ ] **P0** Verify phone call/app switch, poor GPS, denied permissions, and process kill/recovery.
- [ ] **P0** Measure 60-minute battery baseline and document device/build/settings.

**Exit:** An offline locked-screen activity can be paused, resumed after process death, and locally saved without data loss on both platforms.

## Phase 4 — Activity synchronization and review

### 4.1 Activity API

- [ ] **P0** Implement idempotent `POST /v1/activities` using client UUID. (`ACT-1`, reliability NFR)
- [ ] **P0** Validate point/timestamp bounds, sport, duration, route ownership, and conflicting UUID reuse.
- [ ] **P0** Recompute/validate canonical distance, time, pace/speed, polyline, splits, and smoothed GPS elevation state. (`ACT-2`–`ACT-5`)
- [ ] **P0** Reject more than 100,000 filtered points with a stable recoverable error; never silently truncate.
- [ ] **P0** Implement owner-scoped paginated list/detail. (`ACT-6`, `ACT-7`)
- [ ] **P0** Implement title/notes update and confirmed delete. (`ACT-8`, `ACT-9`)
- [ ] **P0** Expose elevation source/fallback status; keep later OpenTopoData enrichment behind an undeployed adapter.

### 4.2 Mobile sync

- [ ] **P0** Commit Save locally before network access and enqueue upload. (`REC-8`)
- [ ] **P0** Trigger sync on save, foreground, auth recovery, and connectivity restoration.
- [ ] **P0** Add exponential backoff/jitter and user-retry state without duplicate activity creation.
- [ ] **P0** Show Waiting to upload/Uploading/Synced/Needs attention states and pending stats banner.
- [ ] **P0** Prove airplane-mode save uploads exactly once after reconnect.

### 4.3 Activity screens

- [ ] **P0** Build reverse-chronological activity list and no-activity CTA. (`ACT-6`)
- [ ] **P0** Build detail map with fit-to-bounds, headline stats, splits, elevation chart, title/notes, and photos region. (`ACT-7`)
- [ ] **P0** Build title/notes edit and destructive delete flows. (`ACT-8`, `ACT-9`)
- [ ] **P0** Apply units consistently to headline stats, splits, chart labels, and list. (`PROF-2`)
- [ ] **P1** Add share image/card through OS share sheet. (`ACT-10`)
- [ ] **P0** Performance-test 200-item list and 5-hour ride polyline on a mid-range phone.

**Exit:** Offline records synchronize once, appear in list/detail, and match deterministic expected stats.

## Phase 5 — Photos

- [ ] **P0** Define signed upload initiation/completion/delete contracts with 15-minute expiry. (`PHO-3`, `PHO-5`)
- [ ] **P0** Enforce ownership, ten-photo limit, 10 MB maximum per input, documented normalized dimension/output limits, and content validation. (`PHO-1`)
- [ ] **P0** Normalize JPEG/HEIC/WebP, strip EXIF, and retain selected location/time separately. (`PHO-1`, `Q7`)
- [ ] **P0** Use private object keys and short-lived signed download URLs; prevent public listing. (`PHO-3`)
- [ ] **P0** Build multi-select library attach and pending upload gallery. (`PHO-1`, `PHO-6`)
- [ ] **P1** Add camera capture from detail/post-save. (`PHO-2`)
- [ ] **P0** Retry failed uploads independently from the activity. (`PHO-6`)
- [ ] **P0** Delete DB record/blob idempotently through outbox; verify account/activity cascade. (`PHO-5`)
- [ ] **P1** Add map markers when explicit capture time/location can map safely to track. (`PHO-4`)

**Exit:** Three-photo QA script passes, one can be deleted, and storage confirms the blob is gone.

## Phase 6 — Routes

- [ ] **P0** Implement owner-scoped route CRUD API and validation. (`RTE-4`, `RTE-5`)
- [ ] **P0** Build route list, empty CTA, and detail map/stats. (`RTE-4`, `RTE-5`)
- [ ] **P0** Build waypoint editor with ordered taps, undo, clear, name validation, raw polyline, and distance. (`RTE-1`, `RTE-3`)
- [ ] **P1** Preserve a provider-neutral routing adapter boundary without connecting a v1 routing service. (`RTE-2`; deferred)
- [ ] **P1** Add route elevation estimate only when a later self-hosted/licensed provider is available. (`RTE-3`)
- [ ] **P1** Support pre-save waypoint adjustment. (`RTE-6`)
- [ ] **P0** Implement Record this route handoff: sport/overlay/route ID prefilled, no automatic start. (`RTE-8`)
- [ ] **P0** Store route ID on resulting activity and enforce owner relationship. (`journey 5.2`)
- [ ] **P0** Run five-waypoint raw-route and route-to-record QA; record the approved v1 snap-to-roads exception.

**Exit:** A user can create an unsnapped route offline-capably, save/view it, and start a recording with its overlay.

## Phase 7 — Training stats and calendar

- [ ] **P0** Implement owner-scoped week totals for distance, moving time, count, and elevation with all/per-sport filter. (`STA-1`)
- [ ] **P0** Implement current year totals with the same metrics. (`STA-2`)
- [ ] **P0** Implement locale/timezone-aware month calendar and day activity query. (`STA-3`)
- [ ] **P1** Add previous/next week and year navigation. (`STA-4`)
- [ ] **P0** Exclude pending local activities and show a sync banner. (`PRD §6.6`)
- [ ] **P0** Build You stats UI, empty states, filters, and unit-aware labels.
- [ ] **P0** Test UTC boundary, DST, locale week-start, mixed sports, deletion, and late sync.

**Exit:** Two-sport weekly QA script matches activity source data in both units and across timezone boundaries.

## Phase 8 — Privacy, accessibility, reliability, and release

### 8.1 Privacy/security

- [ ] **P0** Complete authorization review for every user-owned endpoint and signed object operation.
- [ ] **P0** Verify logs/crash reports redact credentials, signed URLs, raw GPS, and photo metadata.
- [ ] **P0** Add privacy policy and terms URLs with accurate collection, retention, and deletion statements. (`PRD §12.3`)
- [ ] **P0** Complete Apple privacy nutrition and Play data safety declarations.
- [ ] **P0** Run dependency, mobile configuration, API abuse/rate-limit, and object-storage permission reviews.

### 8.2 Accessibility and quality

- [ ] **P0** Audit VoiceOver/TalkBack labels for recording controls, tabs, maps, and destructive actions.
- [ ] **P0** Verify dynamic type and that GPS quality is not color-only. (`PRD §7.6`)
- [ ] **P0** Verify locale-aware number/date formatting and metric/imperial consistency.
- [ ] **P0** Meet crash-free beta target of at least 99.5%; investigate recording-related crashes first.
- [ ] **P0** Validate upload success target of at least 99% within one hour once network returns.

### 8.3 Operations and store readiness

- [ ] **P0** Configure beta isolation, daily Postgres backups, documented restore/runbook drill, migrations, alerts, provider quotas, and key rotation; record any Neon free-tier gap.
- [ ] **P0** Configure privacy-safe structured logs/OpenTelemetry, health/readiness, API metrics, and optional scrubbed Sentry/GlitchTip crash reporting plus sync/elevation/photo failure alerts.
- [ ] **P0** Configure Koyeb free API, Neon free Postgres, Cloudflare R2, Resend SMTP, and OpenFreeMap; verify attribution, terms, quotas, cold-start UX, and explicit no-SLA posture.
- [ ] **P0** Prepare App Store background-location review notes, screenshots, purpose strings, and test account.
- [ ] **P0** Prepare Play foreground-service declaration, notification behavior, data safety, and internal test track.
- [ ] **P0** Run all eight PRD section 16 QA scripts on release candidates and archive evidence; for script 6, replace snap on/off with the approved `RTE-2` deferral record and raw-route/record-handoff evidence.
- [ ] **P0** Verify signup-to-first-save happy path is understandable and under ten minutes excluding activity time.
- [ ] **P0** Triage all open P0 defects; document any P1 cut as a written PRD exception.

**Exit:** Store/internal distribution builds pass the full release checklist on real devices with production-shaped services.

## Deferred backlog

Do not pull these into v1 without a separate scope decision.

### v1.1 candidates

- [ ] Snap-to-roads through a licensed or self-hosted provider; no public demo API. (`RTE-2`)
- [ ] Self-hosted OpenTopoData elevation enrichment adapter.
- [ ] Auto-pause. (`REC-11`)
- [ ] Audio split cues. (`REC-12`)
- [ ] Reverse route waypoint order. (`RTE-7`)
- [ ] Consecutive activity-day streak. (`STA-5`)
- [ ] GPX export.
- [ ] Share-card polish.
- [ ] User-selected offline map region.
- [ ] Data export and account-deletion polish.

### v2+

- [ ] Social feed, follows, kudos, comments, visibility, privacy zones.
- [ ] Segments, leaderboards, clubs, challenges.
- [ ] GPX/FIT import and Garmin/Apple Health/Health Connect integrations.
- [ ] Watch apps, web dashboard, subscriptions, coaching, plans, and safety live tracking.

## Release blockers register

Keep this table current once implementation starts.

| Blocker                             | Owner          | Status  | Required evidence                                                                     |
| ----------------------------------- | -------------- | ------- | ------------------------------------------------------------------------------------- |
| Final product identity/store access | External owner | Blocked | Brand, domain, unique bundle/application IDs, legal owner, paid Apple/Google accounts |
| Beta provider accounts/region       | External owner | Open    | Koyeb/Neon/R2/Resend accounts, region, terms and quota review                         |
| Beta map capacity                   | SWE worker     | Open    | OpenFreeMap attribution/terms/load evidence; Protomaps fallback runbook               |
| Background GPS                      | SWE worker     | Open    | 20-minute locked-screen evidence on iOS/Android                                       |
| Privacy and legal URLs              | External owner | Open    | Published policy/terms and store metadata                                             |
| Account linking                     | External owner | Open    | Approved policy and integration tests                                                 |
| Backup/restore                      | SWE worker     | Open    | Daily target configured, limitation recorded, successful beta restore drill           |
