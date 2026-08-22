# Trail

Trail is an independent iOS/Android outdoor activity application under development. The repository implements the Phase 5 baseline: authenticated accounts, durable offline activity recording/sync, private activity review, and independently retried private photo uploads. Physical-device and Cloudflare R2 release gates remain open.

## Prerequisites

- Node.js 22 (`.nvmrc` and `.node-version`)
- pnpm 10.32.1 (pinned in `package.json`)
- Docker with Compose v2 for local dependencies
- Expo-compatible iOS/Android tooling when running native targets

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
```

Or on a POSIX shell:

```sh
cp apps/api/.env.example apps/api/.env
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

For a physical phone, replace `localhost` in `apps/mobile/.env` with the development machine's LAN address. Only `EXPO_PUBLIC_*` non-secret values may be placed there.

Stop local services without deleting data:

```sh
pnpm infra:down
```

The destructive `pnpm infra:reset` command is documented separately in `infra/README.md`; normal startup and shutdown never delete volumes.

## Verification

Run the same gates as CI:

```sh
pnpm audit:security
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose -f infra/compose.yaml config --quiet
```

Focused API tests:

```sh
pnpm test:api
```

The full local Postgres, MinIO, and Mailpit integration suite uses explicit test-only switches:

```powershell
$env:TEST_DATABASE_URL='postgres://trail:trail_local_only@127.0.0.1:5433/trail'
$env:TEST_MINIO='true'
$env:TEST_MAILPIT='true'
$env:TEST_HEIC='true' # downloads a commit-pinned upstream HEIC fixture
pnpm test:api
```

Phase 5 physical-device and Cloudflare R2 gates are tracked in `Phase5DeviceQA.md`. HEIC is additionally blocked from release pending the LGPL/relinking and HEVC legal review in `THIRD_PARTY_NOTICES.md`; JPEG/WebP remain the shippable photo formats.

## Database migrations

Drizzle source is in `apps/api/src/db`. API startup never migrates automatically.

```sh
pnpm --filter @trail/api db:generate
pnpm --filter @trail/api db:migrate
```

Migrations `0000` through `0003` are the committed foundation/Phase 1/Phase 2/Phase 4 baseline. Phase 5 is a single forward migration that preserves legacy private object-key cleanup reachability while requiring re-upload before legacy photos can become ready. For an immutable release runner, build and run the dedicated migration target:

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

See `infra/README.md` for Koyeb constraints. The selected free beta providers require owner-created accounts, region and quota review, and credentials. Koyeb free service has no SLA and may scale to zero; this foundation makes no production availability claim.

## Environment and dependency security

`EMAIL_MODE=disabled`/`EMAIL_PROVIDER=none` creates no SMTP transport. Local development explicitly selects `smtp`/`mailpit`, which allows unauthenticated plaintext SMTP only outside production. Production SMTP requires a nonlocal provider, username/password, and `SMTP_REQUIRE_TLS=true`; port 465 may also set `SMTP_SECURE=true`. Production configuration also requires a nonlocal TLS Postgres URL (`sslmode=require`), nonlocal TLS object storage, non-placeholder credentials, HTTPS maps, and nonlocal HTTPS OTLP when enabled. Validation errors name fields only and never echo values.

`pnpm audit:security` first audits production dependencies and then the full workspace at moderate severity. Two explicitly named `image-size` advisories inherited by Expo Metro remain temporary exceptions because no patched Expo-compatible release exists; Metro uses that package during developer-controlled native bundling, not the API's Sharp/libheif media-processing path or generated mobile runtime bundle. Untrusted photo bytes are processed only by the bounded API photo workers. Revisit the exceptions immediately when Expo/Metro publishes a fix.

GitHub Actions are pinned to reviewed commit SHAs, and container images use exact release tags. Container digest pinning remains a low-risk maintenance exception so multi-architecture Node/Postgres/MinIO/Mailpit updates remain practical; Dependabot covers root Docker, Compose images, npm, and Actions. Only reviewed `esbuild` and `protobufjs` package-local install scripts are allowed by pnpm.
