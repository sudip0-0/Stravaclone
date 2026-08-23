# Infrastructure operations

## Local services

Local Postgres, MinIO, and Mailpit use persistent named volumes. All published ports bind to `127.0.0.1`. Normal shutdown is non-destructive:

```sh
pnpm infra:up
pnpm infra:down
```

`pnpm infra:reset` is intentionally separate and destructive: it deletes all local service volumes. MinIO root credentials are initializer-only; the API account is bucket-scoped and anonymous access is disabled.

Apply migrations explicitly after dependencies are healthy:

```sh
pnpm --filter @trail/api db:migrate
```

API startup never migrates. Local target checks may build both stages:

```sh
docker build --target migration -t trail-api-migration:local .
docker build --target runtime -t trail-api:local .
```

For a beta release, publish both targets under immutable registry digests. From a trusted workstation, an operator must run the approved migration image by digest exactly once, pass only the database secret, and record its exit status before any runtime change:

```sh
docker pull registry.example.invalid/trail-api-migration@sha256:<APPROVED_DIGEST>
docker run --rm --env DATABASE_URL='<Neon TLS URL from approved secret store>' registry.example.invalid/trail-api-migration@sha256:<APPROVED_DIGEST>
```

Do not use a mutable tag or `apps/api/.env`. A successful command exit is an operator gate; Koyeb does not automatically order migration and runtime deployment.

## Controlled beta template

- `koyeb/service.template.yaml`: official Koyeb Compose `app`/`services[].definition` structure for one API service, port 3000, `/health`, scoped instance/scaling entries, secret references, and an operator-supplied runtime image digest.
- `koyeb/migration-job.template.yaml`: intentionally contains no resource because a continuously restarted worker is not a safe one-shot migration job.
- `beta.env.template`: secret-name inventory for Neon, private R2, Resend, the approved HTTPS map style, and application keys. It is deliberately not a runnable env file.

The template **does not deploy by itself** and contains no provider account IDs, credentials, region, repository, domain, or tile assets. It uses an immutable Docker image source rather than Git, so deploy-on-push is not configured. After replacing placeholders and reviewing the rendered file, an operator may invoke `koyeb compose infra/koyeb/service.template.yaml`; that command has real provider effects and must only happen manually after the migration command exits 0. CI only parses and structurally validates the template. Never claim Koyeb enforces migration ordering.

The intended free beta is isolated Koyeb compute, Neon Postgres, private Cloudflare R2, Resend SMTP, and OpenFreeMap, with an owner-provisioned Protomaps fallback. Free services have no SLA, may sleep/scale to zero, and may change quotas. First requests may be slow; clients must retain local work and retry. `/health` is process liveness; `/ready` is bounded dependency readiness. Quotas, terms, regions, provider backups, billing behavior, and data residency require account-owner review before invitations.

See:

- `docs/release/beta-operations-runbook.md` for migration order, alerts, rollback, provider exits and OpenFreeMap-to-Protomaps switch.
- `docs/release/security-provider-checklists.md` for R2 private policy/CORS and key rotation.
- `docs/release/release-checklist.md` and `Phase8QA.md` for release evidence.

## Validation prerequisites

`pnpm infra:validate` requires Docker Desktop/Engine with Compose v2, Node.js 22, and the lockfile-pinned `yaml` npm package installed. YAML parsing and structural, secret-literal, and credential checks run directly in Node on every platform. Linux/macOS additionally use host Bash for shell syntax checks; the Windows validator requires neither WSL nor a mutable helper container.

The API deployment map style is supplied through Koyeb secret `TRAIL_BETA_MAP_STYLE_URL`. Every mobile map consumes validated build-time `EXPO_PUBLIC_MAP_STYLE_URL`, `EXPO_PUBLIC_MAP_PROVIDER_NAME`, and `EXPO_PUBLIC_MAP_PROVIDER_URL`, declared in `apps/mobile/.env.example`, with the OpenFreeMap HTTPS style and disclosure as defaults. Expo embeds all three public values: switching to an owner-provisioned Protomaps style/provider requires updating them together and rebuilding, testing, and releasing the mobile app; it is not a live runtime/server-secret switch. The configured provider disclosure changes, but OpenStreetMap attribution remains visible on every map.

## Logical backup and restore

Requirements: Bash, Node.js 22, PostgreSQL 17-compatible client tools, OpenSSL, and an operator-selected destination that is encrypted at rest and access-controlled. The scripts encrypt every custom-format logical dump with AES-256-CBC/PBKDF2, then authenticate a versioned canonical manifest with HMAC-SHA256 before publishing the manifest as the pair's completion marker. The HMAC covers all security-relevant manifest fields, including the encrypted dump's SHA-256 checksum and byte count. Restore verifies authentication before trusting the manifest, locating the dump, checking ciphertext, or creating a database. UTC timestamps identify creation time; an independently generated cryptographically random 64-bit hexadecimal suffix provides collision resistance across concurrent runs. Existing names are never overwritten, interrupted temporary artifacts are cleaned, and retention removes only complete same-basename dump/manifest pairs. Encryption and authentication keys must be distinct non-symlink regular files with no group/other permissions, stored separately from each other, the destination, and the repository.

```sh
export DATABASE_URL='<source TLS URL from approved secret store>'
export BACKUP_DESTINATION='/approved/encrypted-at-rest/trail-beta'
export BACKUP_ENCRYPTION_KEY_FILE='/approved/secrets/trail-backup-encryption' # regular file, chmod 600
export BACKUP_ENCRYPTION_KEY_VERSION='encryption-secret-version'
export BACKUP_AUTHENTICATION_KEY_FILE='/approved/secrets/trail-backup-authentication' # distinct regular file, chmod 600
export BACKUP_AUTHENTICATION_KEY_VERSION='authentication-secret-version'
export BACKUP_RETENTION_DAYS=14
bash scripts/ops/postgres-backup.sh
```

Restore is deliberately constrained to a valid database name that does **not** exist. It authenticates the canonical manifest with the version-matched authentication key before trusting any field, verifies ciphertext checksum and size, then creates the database and restores without owners/privileges. It refuses overwrite; on restore failure it removes only the database it just created.

```sh
export ADMIN_DATABASE_URL='<admin/maintenance TLS URL from approved secret store>'
export RESTORE_NEW_DATABASE='trail_restore_yyyymmdd'
export BACKUP_MANIFEST='/approved/encrypted-at-rest/trail-beta/<manifest>.json'
export BACKUP_ENCRYPTION_KEY_FILE='/approved/secrets/trail-backup-encryption'
export BACKUP_ENCRYPTION_KEY_VERSION='encryption-secret-version'
export BACKUP_AUTHENTICATION_KEY_FILE='/approved/secrets/trail-backup-authentication'
export BACKUP_AUTHENTICATION_KEY_VERSION='authentication-secret-version'
bash scripts/ops/postgres-restore-new.sh
```

Validate locally using synthetic data only while local Postgres is healthy:

```sh
bash scripts/ops/validate-backup-restore.sh
```

A daily target and backup-age alert are operational requirements, not configured schedules in this repository. Neon free-tier recovery/branch retention must be confirmed separately. A provider snapshot is not a replacement for export and restore testing.
