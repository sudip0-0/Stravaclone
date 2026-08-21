# Trail

Trail is an independent iOS/Android outdoor activity application under development. Phase 0 provides the workspace, a placeholder four-tab mobile shell, and a production-shaped API foundation; it does **not** implement recording or other product features.

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

## Database migrations

Drizzle source is in `apps/api/src/db`. API startup never migrates automatically.

```sh
pnpm --filter @trail/api db:generate
pnpm --filter @trail/api db:migrate
```

Phase 0's migration creates only a namespace. Feature tables belong to Phase 1. For an immutable release runner, build and run the dedicated migration target:

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

`pnpm audit:security` fails on moderate-or-higher advisories except two explicitly named `image-size` advisories inherited by Expo Metro. There is no patched `image-size` release. Metro uses it only during developer-controlled native bundling; it is absent from the API image and generated mobile runtime bundle, the repository has no web or remote bundler output, and untrusted user images are not processed by this Phase 0 application. Revisit the exceptions immediately when Expo/Metro publishes a fix.

GitHub Actions are pinned to reviewed commit SHAs, and container images use exact release tags. Container digest pinning remains a low-risk maintenance exception so multi-architecture Node/Postgres/MinIO/Mailpit updates remain practical; Dependabot covers root Docker, Compose images, npm, and Actions. Only reviewed `esbuild` and `protobufjs` package-local install scripts are allowed by pnpm.
