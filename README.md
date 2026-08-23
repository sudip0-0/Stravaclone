# Trail

Trail is an independent iOS/Android outdoor activity application under development. The repository implements the application through the local Phase 8 hardening baseline: authenticated accounts, durable offline activity recording/sync, private activity review and photo uploads, raw offline routes, synchronized owner-scoped training totals/calendar, authorization/redaction/config checks, isolated beta templates, and local backup/restore validation. Physical-device, provider/deployment, legal/store/public-URL, measured-beta, and release gates remain open; no deployment is performed by this repository.

## Prerequisites

- Node.js 22.23.2 (`.nvmrc` and `.node-version`)
- pnpm 10.32.1 (pinned in `package.json`)
- Docker with Compose v2 for local dependencies
- Expo-compatible iOS/Android tooling when running native targets
- A POSIX/Linux Bash environment for `security:supply-chain` and `ops:test-backup` (use CI, WSL, or a Linux host on Windows); normal app commands and `infra:validate` run in PowerShell

Enable the pinned package manager if needed:

```sh
corepack enable
corepack prepare pnpm@10.32.1 --activate
```

## First setup

From the repository root:

```sh
pnpm install --frozen-lockfile
```

Create the local API environment on PowerShell:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

Or on a POSIX shell:

```sh
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
```

Start dependencies, apply the foundation migration explicitly, and run the API:

```sh
pnpm infra:up
pnpm --filter @trail/api db:migrate
pnpm dev:api
```

The API listens on `http://localhost:3000`. Liveness is `/health`; bounded, cached dependency readiness is `/ready` and exposes only aggregate status. Mailpit is at `http://127.0.0.1:8025` and the MinIO console at `http://127.0.0.1:9001`. All Compose ports bind only to loopback. The API uses the bucket-scoped `trail-app` MinIO account; root credentials are reserved for the one-shot initializer.

In a second terminal, start Expo:

```sh
pnpm dev:mobile
```

For a physical phone, replace `localhost` in `apps/mobile/.env` with the development machine's LAN address. Only `EXPO_PUBLIC_*` non-secret values may be placed there. `EXPO_PUBLIC_MAP_STYLE_URL`, `EXPO_PUBLIC_MAP_PROVIDER_NAME`, and `EXPO_PUBLIC_MAP_PROVIDER_URL` default to the OpenFreeMap HTTPS style and disclosure. Expo embeds all three at build time, so provider changes require rebuilding, testing, and re-releasing the mobile bundle and are not a live runtime switch. The configured provider disclosure changes, but OpenStreetMap attribution remains visible on every map.

Stop local services without deleting data:

```sh
pnpm infra:down
```

The destructive `pnpm infra:reset` command is documented separately in `infra/README.md`; normal startup and shutdown never delete volumes.

## Verification

After starting local services and exporting the test URLs shown below, run these local equivalents of the primary CI gates:

```sh
pnpm install --frozen-lockfile
pnpm audit:security
pnpm security:release-scan
pnpm security:test
pnpm security:docs:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @trail/mobile test:coverage
pnpm --filter @trail/mobile exec expo install --check
pnpm --filter @trail/mobile exec expo-doctor .
pnpm --filter @trail/mobile exec expo config --type public
pnpm build
pnpm security:supply-chain
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @trail/api db:generate
git diff --exit-code -- apps/api/src/db/migrations
pnpm infra:validate
```

CI additionally validates workflow syntax with the digest-pinned `actionlint` image and runs encrypted backup/restore testing inside the pinned, non-root, read-only validation container defined in `.github/workflows/ci.yml`. That workflow is the authoritative command for those constrained checks. `security:supply-chain` requires POSIX Bash/Linux; on Windows, run it through CI, WSL, or a Linux host. The direct `pnpm ops:test-backup` helper additionally requires Bash, PostgreSQL client tools, OpenSSL, Coreutils, and its documented environment variables, so prefer the CI container unless those prerequisites are installed. `infra:validate` uses its cross-platform Node path automatically.

Focused API and mobile map-configuration tests:

```sh
pnpm test:api
pnpm --filter @trail/mobile test -- src/config/environment.test.ts
```

The full local Postgres, MinIO, and Mailpit integration suite uses explicit test-only switches:

```powershell
$env:TEST_DATABASE_URL='postgres://trail:trail_local_only@127.0.0.1:5433/trail'
$env:TEST_MINIO='true'
$env:TEST_MAILPIT='true'
$env:TEST_HEIC='true' # downloads a commit-pinned upstream HEIC fixture
pnpm test:api
```

Phase-specific physical-device gates are tracked in `Phase3DeviceQA.md` through `Phase7DeviceQA.md`; the eight-record release evidence template is `Phase8QA.md`. Device matrices, Cloudflare R2 parity, provider accounts/terms/quotas, store ownership, and legal/public privacy/terms URLs remain open. HEIC is blocked pending the LGPL/relinking and HEVC legal review in `THIRD_PARTY_NOTICES.md`; JPEG/WebP remain the shippable photo formats.

## Database migrations

Drizzle source is in `apps/api/src/db`. API startup never migrates automatically.

```sh
pnpm --filter @trail/api db:generate
pnpm --filter @trail/api db:migrate
```

Migrations `0000` through `0005` are the committed foundation through Phase 7 chain. `0004` is the Phase 5 forward photo migration that preserves legacy private object-key cleanup reachability while requiring re-upload before legacy photos can become ready. `0005` adds the owner/sport/start-time index used by bounded Phase 7 stats queries; it does not rewrite or roll up activity data. Schema integration tests explicitly apply `0005` after `0004` and verify preserved activity data. For an immutable release runner, a trusted operator must build/pull and run the dedicated migration image before any runtime deployment change:

```sh
docker build --target migration -t trail-api-migration:local .
docker run --rm --network host --env-file apps/api/.env trail-api-migration:local
```

The image runs the compiled Drizzle migrator and exits; it never starts the API.

## Deployment and limitations

Build the API image from the repository root:

```sh
docker build -t trail-api:local .
```

See `infra/README.md` for the credential-free Koyeb/Neon/R2/Resend templates, the explicit operator-run immutable migration command, config-driven map style settings, and encrypted logical backup/restore commands. `docs/release/beta-operations-runbook.md` covers cold starts, no-SLA/quota posture, alerts, rollback, provider exits, and the operational OpenFreeMap-to-owner-provisioned-Protomaps switch (no tile assets are included). The selected providers require owner-created beta-only accounts, region/terms/quota review, secrets, and manual release action. CI validates but never deploys.

Phase 8 release drafts live under `docs/release/`: actual-data inventory, provider security/R2 CORS/key rotation checklists, store review/privacy nutrition/Data safety notes, blocked privacy/terms drafts, and the release checklist. These are unapproved drafts and cannot substitute for legal/store-owner review or public HTTPS URLs.

## Environment and dependency security

`EMAIL_MODE=disabled`/`EMAIL_PROVIDER=none` creates no SMTP transport. Local development explicitly selects `smtp`/`mailpit`, which allows unauthenticated plaintext SMTP only outside production. Production SMTP requires a nonlocal provider, username/password, and `SMTP_REQUIRE_TLS=true`; port 465 may also set `SMTP_SECURE=true`. Production configuration also requires a nonlocal TLS Postgres URL (`sslmode=require`), nonlocal TLS object storage, non-placeholder credentials, HTTPS maps, and nonlocal HTTPS OTLP when enabled. Validation errors name fields only and never echo values.

`pnpm audit:security` first audits production dependencies and then the full workspace at moderate severity. Two explicitly named `image-size` advisories inherited by Expo Metro remain temporary exceptions because no patched Expo-compatible release exists; Metro uses that package during developer-controlled native bundling, not the API's Sharp/libheif media-processing path or generated mobile runtime bundle. Untrusted photo bytes are processed only by the bounded API photo workers. Revisit the exceptions immediately when Expo/Metro publishes a fix.

GitHub Actions are pinned to reviewed commit SHAs. Every CI, runtime, service, and security-scanner container image is pinned to an immutable digest; image updates require an explicit, reviewed digest change. Dependabot covers root Docker, Compose images, npm, and Actions. Only reviewed `esbuild` and `protobufjs` package-local install scripts are allowed by pnpm.
