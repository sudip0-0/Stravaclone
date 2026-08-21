# Infrastructure operations

Local services use persistent named volumes. Normal shutdown is non-destructive:

```sh
pnpm infra:up
pnpm infra:down
```

`pnpm infra:reset` is intentionally separate and destructive: it stops services and deletes all local Postgres, MinIO, and Mailpit data. Do not run it against data you need.

All published ports bind to `127.0.0.1`. MinIO root credentials are used only by the initializer. The API's `trail-app` account receives a policy limited to `trail-private`, and anonymous bucket access is explicitly disabled.

Apply migrations explicitly after services are healthy:

```sh
pnpm --filter @trail/api db:migrate
```

For an immutable release migration runner:

```sh
docker build --target migration -t trail-api-migration:local .
docker run --rm --network host --env-file apps/api/.env trail-api-migration:local
```

No migration runs as part of API startup. Phase 0 creates only the `trail` schema; Phase 1 owns feature tables. The runner contains the compiled migration entry point and migration files and exits after applying them.

## Free beta deployment

The root `Dockerfile` is suitable for an image-based Koyeb service. A Koyeb manifest is intentionally not checked in because the required region, Git repository linkage, domains, and provider accounts remain owner decisions. Configure the service with port `3000`, health path `/health`, readiness path `/ready`, and all validated API environment variables. Run migrations as a separate explicit deployment step.

Koyeb free service has no SLA and may scale to zero. It is appropriate only for the controlled beta described in `Architecture.md`.
