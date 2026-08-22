# Trail v1 Implementation Plan

**Status:** Phase 0 local foundation integrated; Phase 1 local implementation complete; external Phase 0 decisions remain
**Authority:** `PRD.md` is authoritative. This plan sequences delivery; it does not weaken a PRD MUST.  
**Derived documents:** `product.md`, `Architecture.md`, `Tasks.md`, and `Agents.md`  
**Execution model:** The parent orchestrator coordinates bounded assignments using the role ownership in `.devin/orchestration.md`. Phase 0 is led by `infrastructure-specialist`, supported by `swe-worker`, `security-specialist`, and `testing-specialist`, with independent `code-reviewer` and security review.

## 1. Planning rules

1. Work in phase order. A later phase may be explored early, but implementation crosses a phase gate only when dependencies and acceptance evidence exist.
2. Route snap-to-roads is the one explicit v1 SHOULD cut: tap-to-draw remains required, and no public demo routing API may be substituted. Other PRD cuts require a written exception.
3. Automated checks support but do not replace real-device, provider, legal, privacy, or store gates.
4. Each work package gets a bounded assignment, linked PRD/Task IDs, named file ownership, tests, and a handoff report. The parent orchestrator integrates cross-package changes.
5. `design-specialist` is assigned UI/UX/accessibility work only when an approved design source exists. Otherwise it may review behavior specifications but must not invent visual requirements.
6. Commit boundaries below are recommended atomic review points, not evidence that commits or implementation currently exist.
7. Never use real user GPS/photos in fixtures. Never log credentials, tokens, signed URLs, raw tracks, or photo metadata.

## 2. Fixed implementation baseline

- Node.js 22 and pnpm workspaces.
- Expo SDK 57; use the React Native version required by Expo.
- Fastify Node/TypeScript modular API.
- Zod for shared wire contracts and environment validation.
- Drizzle ORM/migrations with Postgres.
- Vitest, ESLint, and Prettier.
- Local Docker Compose: Postgres 17, MinIO, Mailpit.
- Free beta: Koyeb free service (no SLA; scale-to-zero/cold starts), Neon free Postgres, private Cloudflare R2, Resend free-tier SMTP.
- MapLibre with OpenFreeMap public instance and visible OSM/provider attribution; self-hosted Protomaps fallback.
- Smoothed GPS elevation in v1; provider boundary for later self-hosted OpenTopoData.
- Structured logs/OpenTelemetry; optional scrubbed Sentry or GlitchTip.
- Stable client UUID idempotency; 100,000 filtered points/activity; retained filtered points in v1.
- Access token 15 minutes; refresh token 30 days with rotation, family tracking, and reuse detection.
- Maximum 10 photos/activity and 10 MB per input image.
- Development slug `trail`; temporary iOS/Android IDs `com.trailapp.mobile`. Final brand/domain/store identity is externally blocked.

---

## Phase 0 — Decisions and project foundation

### Goal

Create a reproducible, production-shaped monorepo foundation without implying that free beta infrastructure has production availability.

### Dependencies

- Approved `PRD.md`, architecture decisions, and this plan.
- Node 22, pnpm, Docker, and Expo-compatible local prerequisites.
- External provider accounts are not required for local bootstrap; use validated placeholders and local adapters.

### Exact work packages and assigned roles

1. **P0.1 Workspace scaffold — `infrastructure-specialist` lead with `swe-worker` support**
   - Create pnpm workspace packages exactly as defined in `Architecture.md`.
   - Pin Node 22 and package-manager metadata; bootstrap Expo SDK 57 and Expo-compatible React Native.
   - Bootstrap Fastify API and shared `contracts`, `domain`, and `config` packages.
2. **P0.2 Tooling/CI — `infrastructure-specialist` lead with `swe-worker` and `testing-specialist` support**
   - Strict TypeScript, ESLint, Prettier, Vitest, package scripts, lockfile policy, and CI cache/install/check pipeline.
   - Zod-validated environment modules and credential-free examples.
3. **P0.3 Local infrastructure — `infrastructure-specialist` lead with `security-specialist` support**
   - Docker Compose for Postgres 17, MinIO, and Mailpit with health checks, persistent named volumes, and reset instructions.
   - Drizzle configuration and explicit migration command; no auto-migrate on API request startup.
4. **P0.4 API platform — `swe-worker` with `infrastructure-specialist` lead and `security-specialist` review**
   - Fastify health/readiness, request IDs, stable error envelope, redacted structured logs, OpenTelemetry bootstrap, graceful shutdown.
   - SMTP, object storage, telemetry, map/elevation/routing provider interfaces with local adapters only.
5. **P0.5 Shell UX specification/review — `mobile-specialist` with `design-specialist` only if approved design exists**
   - Verify navigation/state/accessibility specification for auth and four tabs; do not build feature screens early.
6. **P0.6 Integration — parent orchestrator with independent `code-reviewer`, `security-specialist`, and `testing-specialist` evidence**
   - Review dependency versions, workspace boundaries, provider abstraction, CI gates, and documentation commands.

### Acceptance gates

- Clean checkout installs with frozen lockfile and runs format check, lint, typecheck, tests, and builds.
- Local Postgres/MinIO/Mailpit become healthy; API readiness reflects dependencies.
- Environment startup fails clearly on missing/invalid values; no credentials are committed.
- No application feature is marked complete from scaffold-only work.

### Automated verification

- `pnpm install --frozen-lockfile`.
- Workspace format check, ESLint, TypeScript, Vitest, and build commands defined during bootstrap.
- Docker Compose config validation and service health smoke test.
- API health/readiness and redaction tests.

### Status and evidence (2026-08-22)

- **Implemented, repaired, and locally integrated:** P0.1–P0.4 and the non-visual P0.5 placeholder shell. Blocking/high/medium review findings and Phase 1 integration regressions were repaired; external provider/identity decisions and independent release reviews remain outside the local foundation gate.
- `pnpm install --frozen-lockfile`, `pnpm audit:security`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed locally on Node 22.19.0 and pnpm 10.32.1. Focused API coverage is 23 passing tests across environment/SMTP security, deduplicated bounded readiness, safe errors, query/request-ID log redaction, span-attribute privacy, local providers, and telemetry-before-runtime ordering.
- The Expo build now exports only Android and iOS. Expo SDK 57.0.13, React 19.2.3, and Expo-selected React Native 0.86.2 remain aligned; web scripts, output, React DOM, and React Native Web were removed.
- Audit remediation upgraded or overrode Fastify, Drizzle, Nodemailer, OpenTelemetry, Vitest, esbuild, fast-xml-parser, uuid, and protobufjs. Full and production audits report zero critical and two high advisories, both unpatched `image-size` issues reachable only through Expo Metro build tooling; CI ignores only those named advisories with rationale in `README.md`.
- Compose validation, runtime and immutable migration image builds, and the migration image execution passed. Postgres 17, MinIO, and Mailpit became healthy on loopback-only ports; `/health` and aggregate `/ready` returned 200; the scoped MinIO app account completed object write/stat/delete, was denied access to a second bucket, and anonymous access returned 403.
- Services were stopped with `down` and the three named volumes remain. No feature schema or product feature was added. External provider accounts, beta region/quotas/terms, final identity, store accounts, and optional external Sentry/GlitchTip remain blocked or deliberately disabled.

### Manual/external blockers

- Final brand/domain/legal owner/store IDs and paid Apple/Google accounts.
- Koyeb/Neon/R2/Resend accounts, beta region, quotas, and terms review.
- Sentry/GlitchTip choice is optional and may remain disabled.

### Commit boundary

1. `chore: bootstrap pnpm workspace and tooling`
2. `chore: add local infrastructure and migrations`
3. `feat: add API platform observability and provider ports`

---

## Phase 1 — Contracts, domain, and data

### Goal

Establish shared validated contracts, deterministic GPS/stat calculations, and the owner-private relational model before feature APIs or screens depend on them.

### Dependencies

- Phase 0 workspace, tests, Drizzle workflow, and local Postgres.
- PRD data model, GPS NFRs, and fixed limits.

### Exact work packages and assigned roles

1. **P1.1 Zod contracts — `swe-worker`**
   - Sports, units, auth/session DTOs, users, activity/point/split/elevation, routes, photos, stats, cursor pagination, provider status, and error codes.
   - Central constants: 12-hour duration, save threshold, 100,000 filtered points, 10 photos, 10 MB input.
2. **P1.2 Pure activity domain — `swe-worker`**
   - Coordinate/time validation, accuracy classification, sport jump rejection, geodesic distance, pauses/moving time, split generation, pace/speed, polyline encoding, display downsampling.
   - Deterministic smoothed-GPS elevation and explicit `gps_smoothed` source; OpenTopoData interface only, not deployment.
3. **P1.3 Drizzle schema — `swe-worker`**
   - Users, identities, refresh token families/tokens, activities, retained filtered points, splits/elevation, routes, photos, and object deletion outbox.
   - UUID, ownership FKs, check/unique constraints, UTC timestamps, indexes, migration and synthetic factories.
4. **P1.4 Contract/data review — parent orchestrator**
   - Confirm wire compatibility, no provider payload leakage, no unfiltered retention promise, owner query paths, and rollback notes.

### Acceptance gates

- Invalid payloads fail with stable schema errors.
- Domain fixtures produce deterministic expected distance/time/splits/elevation.
- Database enforces client UUID uniqueness and ownership relationships; request replay/conflict semantics are deferred to Phase 4.
- Accepted filtered points remain stored; display downsampling does not mutate source data.

### Automated verification

- Vitest property/fixture tests for poor accuracy, impossible jumps, pauses, gaps, unit changes, final partial splits, and elevation noise.
- Migration up/down or forward-recovery tests on Postgres 17.
- Constraint/index integration tests and schema/contract serialization tests.

### Status and evidence (2026-08-22)

- **Complete for local Phase 1 scope:** shared Zod contracts, deterministic activity domain functions, core Drizzle schema/migrations, synthetic DB factories, and the parent contract/data integration review are implemented. Phase 2 and later work remains untouched.
- The API now consumes the provider-neutral `ElevationProvider`, request, and result types from `@trail/domain`; local and test adapters return only positional `elevationsM` results, with no concrete provider payload in the API boundary. API package dependency, TypeScript project-reference, and workspace build wiring were verified.
- `pnpm install --frozen-lockfile`, `pnpm audit:security`, `pnpm format:check`, `pnpm lint`, root `pnpm typecheck`, direct `pnpm exec tsc -p apps/api/test/tsconfig.json`, `pnpm test`, and `pnpm build` passed. Tests comprised 20 contract, 22 domain, and 35 API tests, including 11 Postgres 17 migration/constraint/index integration tests.
- Postgres 17 was started from `infra/compose.yaml` with its existing named volume, reached healthy state, and the full suite ran with `CI=true` plus `TEST_DATABASE_URL`. `drizzle-kit generate` reported “No schema changes,” Compose configuration validated, and `git diff --check` passed.
- The schema reserves owner-scoped client UUID uniqueness. Identical replay versus immutable-payload conflict behavior is an activity API concern and remains explicitly deferred to Phase 4.

### Manual/external blockers

- None for local implementation. Storage cost from retained points must be measured during beta, not guessed away.

### Commit boundary

1. `feat: define shared Trail contracts and limits`
2. `feat: implement deterministic activity domain`
3. `feat: add core Drizzle schema and migrations`

---

## Phase 2 — Authentication, profile, and app shell

### Goal

Deliver secure account/session behavior and the navigable mobile shell with profile units, while preserving drafts during sign-out.

### Dependencies

- Phase 1 auth/user contracts and schema.
- Apple/Google configuration for SSO acceptance; email/password can proceed locally.

### Exact work packages and assigned roles

1. **P2.1 Email/session API — `swe-worker`**
   - Non-enumerating `202` registration request plus one-use email verification confirmation, normalized email, Argon2id parameters, layered rate limits, and private login errors.
   - 15-minute versioned JWT access tokens; opaque hashed 30-day refresh tokens; encrypted same-request successor recovery until successor consumption/expiry/revocation, family reuse revocation, and idempotent logout/reset access invalidation.
2. **P2.2 SSO/linking — BLOCKED**
   - Keep canonical Apple/Google JOSE/JWKS verifier interfaces non-routable.
   - Do not add sign-in/link routes until server-owned one-use state/nonce/PKCE, real native/provider setup, and recent step-up for permanent linking are independently reviewed.
3. **P2.3 Profile/delete/password reset — `swe-worker`**
   - `GET/PATCH/DELETE /v1/me`, units/default sport, confirmed deletion/outbox.
   - One-use expiring reset token via an AES-GCM encrypted transactional email outbox: Mailpit local, Resend beta. Request returns immediately and confirmation is `204 No Content`.
4. **P2.4 Mobile auth/session shell — `swe-worker`**
   - Secure storage, coordinated refresh/replay, onboarding/auth screens, four-tab navigation, profile/settings/legal placeholders, active-draft sign-out guard.
5. **P2.5 UX/accessibility — `design-specialist` with approved design**
   - Review loading/error/denial states, dynamic type, labels, focus order, and linked-account presentation.
6. **P2.6 Security integration review — parent orchestrator**
   - Threat review for account enumeration, token theft/reuse, callback confusion, owner isolation, and log redaction.

### Acceptance gates

- Refresh rotation survives delayed cold recovery by reusing a persisted `rotation_request_id` while its linked successor remains usable; successor consumption clears recovery and any later/different-ID old-token replay revokes the family.
- All owner endpoints reject cross-user access; logout increments auth version only for newly revoked families, reset invalidates access immediately, and deletion uses atomic password/version conditions with layered attempt limits.
- Registration and reset use equivalent encrypted delivery/tombstone outbox work for known/unknown addresses, bounded retries, pasteable one-use tokens, and tight tombstone/completed/dead retention.
- The entirely uncommitted Phase 2 schema ships as one additive `0002_phase2_auth.sql` from committed Phase 1; preservation and replay are tested.
- SSO and linking routes remain absent until real native/provider evidence and the state/nonce/PKCE/step-up design pass review.
- Global unit changes propagate through shell state.

### Automated verification

- Vitest/API integration tests for verified/non-enumerating registration, password policy, layered/random-identifier rate limiting, access expiry, delayed rotation recovery, family reuse, idempotent logout, profile/deletion step-up, migration preservation, and cascade/outbox retention.
- Mobile integration tests for secure session restore, coordinated refresh, and sign-out draft guard.
- Accessibility static checks where supported.

### Mobile status and evidence (2026-08-22)

- Mobile registration now treats `POST /v1/auth/register` as a non-enumerating `202 accepted`, navigates to a paste-token verification screen, and stores no credentials until `POST /v1/auth/register/confirm` returns a valid session. The verification state provides native back navigation, request-new-email handoff, retry, field focus, and safe generic errors; new and existing-email request responses are indistinguishable to the client.
- Password reset remains a paste-token flow with `204` confirmation. Account deletion collects current password, maps `403 step_up_failed` to a password-verification error, performs exactly one DELETE without refresh, and retains credentials; `step_up_required` remains an honest SSO-only blocker. Draft state remains injected through `AppStateProvider`, with the explicit clear default temporary until Phase 3 supplies its durable reporter.
- The mobile baseline is Expo SDK `57.0.13` (published at least seven days before integration), React 19.2.3, and Expo-selected React Native 0.86.2, with compatible Expo modules and the required `expo-font`/`@expo/dom-webview` peers. Expo dependency validation intentionally excludes only the newer Expo `57.0.15` patch recommendation so the reviewed mature `57.0.13` remains pinned; all other dependencies are current and Expo Doctor passes 21/21 checks. Seven mobile test files contain 30 passing tests. V8 coverage for selected pure auth/session/state modules is 87.59% statements/lines, 83.17% branches, and 82.60% functions, enforced in CI.
- Frozen install, format, lint, workspace typecheck/tests, coverage, Expo dependency/config/Doctor checks, security audit, and Android/iOS exports pass. API database/auth/Mailpit integration cases remain skipped without their external test services. Simulator/physical-device accessibility, native SSO, and signed release-build evidence are not claimed.

### Manual/external blockers

- Apple/Google developer projects, native callback setup, server-owned one-use state/nonce/PKCE, recent provider step-up, paid distribution accounts, and real provider/device proof remain blocked. There are deliberately no SSO or linking API routes; local JWKS verifier tests are not SSO completion evidence.
- Published legal URLs are required by Phase 8, not local shell completion.

### Commit boundary

1. `feat: add email auth and rotating sessions`
2. `feat: add profile and account lifecycle`
3. `feat: add mobile auth shell and secure session restore`
4. `feat: add Apple and Google sign-in` only after external setup

---

## Phase 3 — Reliable GPS recording

### Goal

Make recording offline-first, crash-safe, background-capable, and understandable on real iOS/Android devices.

### Dependencies

- Phase 1 domain rules/contracts; Phase 2 authenticated shell and secure identity.
- Expo development builds/native configuration; simulator alone is insufficient.

### Local implementation status

- Pure state/clock/crash-window/point-limit/owner-isolation/permission/unit-format/payload tests, in-memory repository contracts, and static config/accessibility checks are automated. Coverage percentages refer only to the selected modules in `apps/mobile/vitest.config.ts`, not native SQLite, TaskManager, MapLibre, foreground services, or OS lifecycle execution.
- Owner-scoped local records, per-owner active uniqueness, terminal collector quarantine, prepared/confirmed/unresolved deletion intent, exact-row DB confirmation plus this-device-only SecureStore fallback, cleanup-required blocking retry, confirmed-only cleanup retry, 30-day abandoned-draft retention, 90-day unconfirmed-intent expiry without data deletion, SQLCipher configuration/key handling, atomic retryable migrations, bounded display queries, direct-recoverable creation, durable-before-native stop, idempotent save, generation-safe foreground fallback, ordered bounded persistence retries with explicit durable failure, total task-payload bounds plus lossless chunking, monotonic raw-fix HUD state, and default-off map networking are implemented in code. Native SQLite encryption/migration/cleanup/fault injection, OS process death, watcher races, and network-request evidence remain unverified until development-build device QA.
- Official Expo SDK 57 modules use Expo’s current expected patches under an explicit compatibility/security exception to the normal seven-day dependency-age policy.
- All real-device background, SQLCipher, process-death, FGS, map, accessibility, and battery gates remain **blocked** and unpassed. Expo Location exposes one privacy-safe persistent Android FGS notification but does not guarantee dynamic elapsed/distance updates; REC-4’s dynamic notification remains a device/custom-native gate. Evidence belongs in `Phase3DeviceQA.md`; mocks, exports, repository contracts, and generated config are not device-success evidence.

### Exact work packages and assigned roles

1. **P3.1 Durable state machine — `swe-worker`**
   - Mobile SQLite schema/migrations for sessions, filtered points, sync jobs, pending photos.
   - Allocate stable activity UUID before capture; implement Idle/Starting/Recording/Paused/Stopping/Saving states.
   - Checkpoint at least every five seconds or batch threshold; restore recording/paused state after process death.
2. **P3.2 Location pipeline — `swe-worker`**
   - Expo location/task integration, 1 Hz target, accuracy/jump filtering, distance/HUD calculations, 100,000-point guard without silent loss.
   - 12-hour stop and 30-second-or-50-metre save rule.
3. **P3.3 Native background/permissions — `swe-worker`**
   - iOS background mode/purpose strings and staged permissions.
   - Android API 26+ location foreground service, persistent notification, Android 13+ notification handling, OEM guidance.
4. **P3.4 Record interaction — `design-specialist` with approved design; implementation pairing with `swe-worker`**
   - Sport selector, GPS icon/text/color state, accessible HUD, MapLibre puck/polyline/follow, pause/resume/stop, save/discard, resume prompt.
   - OpenFreeMap attribution remains visible and unobscured.
5. **P3.5 Device evidence — parent orchestrator coordinates; `swe-worker` fixes defects**
   - Locked screen, call/app switch, airplane mode, process kill, denied/poor GPS, battery baseline.

### Acceptance gates

- Offline locked-screen recording locally saves with stable UUID and no data loss.
- Process kill restores accepted points and state.
- Pause does not append points or moving time.
- Current/previous iOS target and representative Android devices pass 20-minute locked-screen scripts.
- Attribution and accessibility remain visible during recording.

### Automated verification

- State-machine transition tests, SQLite transaction/recovery tests, location fixture tests, point-limit tests, permission-state tests, and clock/process-restart tests.
- Mobile build/config validation for iOS background mode and Android foreground-service declarations.

### Manual/external blockers

- Physical supported devices, OS permissions, Apple location review risk, Android OEM battery behavior.
- OpenFreeMap public-instance terms/network availability; cached tiles are best effort only.

### Commit boundary

1. `feat: add durable recording state and storage`
2. `feat: add filtered location pipeline`
3. `feat: configure background location and permissions`
4. `feat: build accessible recording experience`
5. `test: document real-device recording evidence`

---

## Phase 4 — Activity synchronization and review

### Goal

Upload each local activity exactly once, compute trusted canonical stats, and provide complete list/detail review with transparent elevation source.

### Dependencies

- Stable local UUID/session output from Phase 3.
- Phase 1 activity contracts/domain/schema and Phase 2 auth.

### Exact work packages and assigned roles

1. **P4.1 Activity API — `swe-worker`**
   - Idempotent create keyed by stable client UUID; identical replay returns existing activity, immutable conflict returns 409.
   - Validate owner/route, duration/order/ranges, and maximum 100,000 filtered points (`413` stable error).
   - Recompute canonical distance, times, splits, polyline, and smoothed GPS elevation; persist filtered points.
   - Owner-scoped cursor list/detail, edit title/notes, confirmed delete.
2. **P4.2 Sync engine — `swe-worker`**
   - Save locally before network, trigger on save/foreground/auth/connectivity, exponential backoff/jitter, explicit retry and terminal state.
   - Coordinated auth refresh; no duplicate write after timeout/unknown response.
3. **P4.3 Activity screens — `design-specialist` with approved design; `swe-worker` implements data behavior**
   - Reverse chronology, pending banner, map fit, stats, unit splits, elevation chart labeled `GPS smoothed`, photos placeholder, edit/delete, empty/error states.
4. **P4.4 Performance/integration — parent orchestrator**
   - Review five-hour geometry rendering, 200-item list, conflict semantics, and retained-point storage profile.

### Acceptance gates

- Airplane-mode save synchronizes exactly once after reconnect.
- Conflicting UUID is rejected and never overwrites source data.
- API totals match deterministic fixtures and ownership is enforced.
- List/detail perform on a mid-range device; elevation never claims DEM source in v1.

### Automated verification

- API integration tests for identical replay, conflict, 100,001-point rejection, owner isolation, pagination, update/delete, and canonical recomputation.
- Sync tests for timeout-after-commit, backoff, reconnect, auth refresh, app restart, and terminal errors.
- UI/component tests for units, pending states, empty states, and elevation-source labels.

### Manual/external blockers

- Real network transition/device performance evidence.
- Koyeb scale-to-zero behavior is evaluated in Phase 8 beta deployment, not hidden in client timeout behavior.

### Commit boundary

1. `feat: add idempotent activity API`
2. `feat: add offline activity synchronization`
3. `feat: add activity list and detail`
4. `perf: validate long activity rendering`

---

## Phase 5 — Photos

### Goal

Attach private photos independently of activity synchronization with secure direct uploads, retry, normalization, and reliable deletion.

### Dependencies

- Phase 4 synchronized activity IDs/detail.
- Local MinIO; Cloudflare R2 account required only for beta gate.

### Exact work packages and assigned roles

1. **P5.1 Upload API/storage — `swe-worker`**
   - Initiate/complete/delete contracts, owner checks, private object keys, 15-minute signed URLs, existence/type/size verification.
   - Enforce 10 photos/activity and 10 MB per input; define normalized output dimension/byte policy.
2. **P5.2 Media processing/privacy — `swe-worker`**
   - Normalize JPEG/HEIC/WebP, strip EXIF, retain only explicit capture time/location, reject malformed/polyglot content.
3. **P5.3 Retry/delete lifecycle — `swe-worker`**
   - Pending jobs independent of activity upload; idempotent completion/delete; outbox cleanup for photo/activity/account deletion.
4. **P5.4 Gallery UX — `design-specialist` with approved design; `swe-worker` integration**
   - Multi-select attach, progress/pending/failure/retry, delete confirmation, optional camera, optional safe markers.
5. **P5.5 Storage security review — parent orchestrator**
   - Bucket listing/public ACL denied, signed URL expiry, orphan reconciliation, R2/MinIO parity.

### Acceptance gates

- Three-photo script passes; deleted photo is absent from DB and object storage.
- Eleventh and over-10-MB inputs fail safely.
- Activity save/detail remains usable while photo upload is pending/failed.
- Objects cannot be listed or fetched without valid authorization/signature.

### Automated verification

- Contract/API tests for limits, ownership, expiry, completion races, malformed content, retry, and outbox idempotency.
- MinIO integration tests for private ACL and object deletion.
- UI tests for partial success and retry states.

### Manual/external blockers

- Cloudflare R2 bucket/CORS/credentials and free-tier terms.
- Camera/library permission testing on real devices.

### Commit boundary

1. `feat: add private signed photo uploads`
2. `feat: add photo normalization and cleanup outbox`
3. `feat: add pending photo gallery and retry`

---

## Phase 6 — Routes

### Goal

Ship reliable tap-to-draw personal routes and route-to-record handoff without an unlicensed routing dependency.

### Dependencies

- Phase 1 route contracts/schema/domain distance.
- Phase 3 MapLibre recording surface and Phase 4 owner/activity relationship.

### Exact work packages and assigned roles

1. **P6.1 Route API — `swe-worker`**
   - Owner-scoped CRUD, ordered waypoint/name/coordinate validation, raw polyline/distance, cursor list.
   - Keep dormant provider-neutral routing/elevation ports; no network adapter in v1.
2. **P6.2 Builder/detail UX — `design-specialist` with approved design; `swe-worker` integration**
   - Ordered map taps, undo, clear, name, distance, list/empty/detail/delete, visible attribution.
   - Do not show a nonfunctional Snap control as available v1 behavior.
3. **P6.3 Recording handoff — `swe-worker`**
   - Prefill sport/overlay/route ID without auto-start; preserve route owner check on activity save.
4. **P6.4 Scope evidence — parent orchestrator**
   - Record PRD `RTE-2` SHOULD exception and verify no public demo routing endpoint/key exists.

### Acceptance gates

- Five-waypoint raw route saves, reopens, deletes, and seeds recording.
- Resulting activity stores an owned route ID; cross-owner IDs fail.
- Route creation remains usable without routing/elevation network calls.

### Automated verification

- Route schema/API ownership/CRUD tests, waypoint distance fixtures, handoff state tests, attribution/UI-state tests.
- Dependency/config scan confirms no demo routing service.

### Manual/external blockers

- Snap-to-roads and self-hosted OpenTopoData are post-v1; they are not blockers.
- Map provider terms/capacity remain a beta release gate.

### Commit boundary

1. `feat: add owner-scoped route API`
2. `feat: add tap-to-draw route experience`
3. `feat: connect route recording handoff`

---

## Phase 7 — Training stats and calendar

### Goal

Provide trustworthy synchronized week/year totals and a locale-aware calendar derived from saved server activities.

### Dependencies

- Phase 4 canonical synchronized activities/delete behavior.
- Profile units/timezone inputs from Phase 2.

### Exact work packages and assigned roles

1. **P7.1 Stats queries — `swe-worker`**
   - Owner-scoped current week/year totals by all/sport, explicit validated timezone and locale week boundary, month/day activity queries.
   - Query indexed activities; no premature OLAP/rollup service.
2. **P7.2 Stats UI — `design-specialist` with approved design; `swe-worker` integration**
   - Week/year cards, sport filters, calendar/day list, units, empty states, pending-sync banner.
3. **P7.3 Temporal correctness — `swe-worker`**
   - UTC/DST/year boundary, locale week start, late sync, deletion, unit changes, mixed-sport fixtures.
4. **P7.4 Product verification — parent orchestrator**
   - Compare visible totals against source activities and ensure local pending activity is excluded with explanation.

### Acceptance gates

- Two-sport weekly script matches source activities in metric/imperial.
- DST, timezone, week-start, year boundary, deletion, and late-sync cases are correct.
- Pending local activities do not silently alter server totals.

### Automated verification

- Postgres integration tests over UTC/DST/locale fixtures and query plans/index use.
- UI tests for filters, calendar navigation, unit labels, pending and empty states.

### Manual/external blockers

- Device locale/timezone matrix testing; no third-party provider dependency.

### Commit boundary

1. `feat: add timezone-aware stats queries`
2. `feat: add training totals and calendar`
3. `test: cover temporal stats boundaries`

---

## Phase 8 — Privacy, accessibility, reliability, and beta release

### Goal

Prove the complete PRD journeys on real devices and deploy a transparent, recoverable free beta without claiming an SLA or public-scale readiness.

### Dependencies

- Phases 0–7 gates met; no open P0 implementation defects.
- External provider/store/legal access where applicable.

### Exact work packages and assigned roles

1. **P8.1 Security/privacy — `swe-worker`**
   - Endpoint/object authorization matrix, rate-limit/abuse tests, dependency/mobile config review, deletion verification, secret rotation procedure.
   - Confirm structured logs/OTel and optional Sentry/GlitchTip scrub GPS, media metadata, credentials, and signed URLs.
2. **P8.2 Accessibility/release UX — `design-specialist` with approved design**
   - VoiceOver/TalkBack, dynamic type, non-color GPS state, focus order, destructive actions, map/HUD attribution, cold-start/retry messaging.
3. **P8.3 Beta infrastructure — `swe-worker`**
   - Koyeb free API, Neon free Postgres, private R2, Resend SMTP, OpenFreeMap configuration; isolated credentials and explicit migrations.
   - Document Koyeb no SLA/scale-to-zero, cold-start behavior, quotas, and provider exit/fallback.
4. **P8.4 Backup/restore — `swe-worker`**
   - Configure daily database backup target using available Neon capability or external scheduled logical export.
   - Write restore runbook, perform beta restore drill, record achieved recovery window and every free-tier limitation; do not promise unsupported RPO/RTO.
5. **P8.5 Maps fallback — `swe-worker`**
   - Verify visible attribution/terms and document/test operational switch to self-hosted Protomaps where feasible.
6. **P8.6 Device/store evidence — parent orchestrator**
   - Run all PRD section 16 scripts and archive versions/devices/results. For script 6, substitute the approved `RTE-2` SHOULD-deferral record plus raw-route/record-handoff evidence for snap on/off. Review privacy/terms/store declarations and background-location materials.
7. **P8.7 Release decision — parent orchestrator**
   - Review metrics, provider risks, P1 exceptions, external blockers, rollback, and support path. Label release closed free beta only.

### Acceptance gates

- All PRD MUST journeys and eight minimum QA scripts pass, including 20-minute locked-screen recording on supported real devices; script 6 carries the explicit snap-to-roads SHOULD exception and replacement route evidence.
- Crash-free beta and upload-success targets have measured evidence or remain explicitly unachieved; never mark from configuration alone.
- Daily backup path and successful restore drill are documented with actual limitations.
- Private R2 access, SMTP delivery, OpenFreeMap attribution, and Koyeb cold-start/retry behavior pass beta checks.
- Privacy policy/terms and store declarations match actual collection.
- No claim of SLA, public scale, or final store readiness is made.

### Automated verification

- Full frozen install, format, lint, typecheck, Vitest/integration suites, migration check, and production builds.
- Authorization matrix, rate-limit, dependency/security scan, log-scrub assertions, backup artifact/restore validation, synthetic uptime/cold-start checks.
- Release configuration scan for dev secrets, public buckets, OSM Foundation tile URLs, demo routing APIs, and missing attribution.

### Manual/external blockers

- Final brand/domain/legal owner and globally unique store IDs.
- Paid Apple Developer and Google Play accounts, OAuth registrations, store review, privacy/terms URLs.
- Physical device matrix and background-location approvals.
- Provider accounts, beta region, free-tier quota/retention changes, and any backup destination.
- A future public launch requires separate capacity/SLA/cost decisions; it is outside this free-beta plan.

### Commit boundary

1. `chore: harden privacy observability and authorization`
2. `chore: configure free beta infrastructure`
3. `docs: add backup restore and provider runbooks`
4. `test: archive accessibility and device release evidence`
5. Release tag only after parent-orchestrator gate approval; no tag is implied by this plan.

---

## 3. Cross-phase risk register

| Risk                                 | Earliest control                                               | Release posture                                         |
| ------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------- |
| Background GPS killed by OS/OEM      | Phase 3 durable buffer, foreground service, device matrix      | P0 real-device blocker                                  |
| Koyeb cold start/no SLA              | Phase 0 abstraction; Phase 8 measurements/retry UX             | Accepted only for controlled free beta                  |
| Free-tier quota/terms change         | Provider ports, quota monitoring, exit runbooks                | Reassess before every beta expansion                    |
| OpenFreeMap capacity/terms           | Visible attribution and monitoring; Protomaps fallback         | No public-scale assumption                              |
| Duplicate activity after timeout     | Stable UUID + transactional API idempotency                    | P0 automated/offline gate                               |
| Point/photo abuse or storage growth  | 100k filtered-point and 10 × 10 MB input limits                | Measure retained-point and normalized-media cost        |
| Refresh theft/replay                 | 15m access, 30d rotation, hashed families/reuse revocation     | P0 security gate                                        |
| Noisy elevation                      | Deterministic smoothed GPS and source label                    | OpenTopoData remains later work                         |
| Backup capability weaker than target | Daily target, external export option, restore drill            | Publish achieved limitation, not fictional RPO/RTO      |
| Store identity/access unavailable    | Temporary dev identity; external blocker register              | Beta sideload/dev work can proceed; distribution cannot |
| Sensitive telemetry leakage          | Structured allowlist, OTel, scrub tests, optional error vendor | Third-party exporter stays disabled until proven        |

## 4. Completion semantics

This document records intended work only. A checked decision in `Tasks.md` means the choice is settled, not that code, accounts, infrastructure, QA, or release work exists. Phase completion requires its acceptance evidence and parent-orchestrator review; Trail v1 remains incomplete until the authoritative PRD acceptance criteria pass.
