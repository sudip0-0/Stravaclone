# Key and session rotation runbook

Verified against `apps/api/src/config.ts`, `apps/api/src/auth/crypto.ts`, `apps/api/src/auth/service.ts`, and auth integration tests on 2026-08-23.

## Key inventory

| Setting                                                                | Purpose                                                                           | Format                                                                   | Rotation capability                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `JWT_SIGNING_KEY`                                                      | HS256 access-token signing                                                        | distinct 32-byte base64url                                               | Cold replacement; no overlap/key ID support                                         |
| `REFRESH_RECOVERY_KEY`                                                 | AES-256-GCM encryption of a short-lived refresh successor recovery value          | distinct 32-byte base64url                                               | Cold replacement; outstanding idempotent refresh recovery values become unreadable  |
| `EMAIL_OUTBOX_KEY`                                                     | AES-256-GCM encrypted email-outbox payloads                                       | distinct 32-byte base64url                                               | Cold replacement only after pending encrypted jobs are drained or invalidated       |
| `OBJECT_STORAGE_ACCESS_KEY` / `OBJECT_STORAGE_SECRET_KEY`              | Private object provider credentials                                               | provider-defined                                                         | Provider overlap procedure; restart API/workers                                     |
| `SMTP_PASSWORD`                                                        | SMTP provider credential                                                          | provider-defined                                                         | Provider overlap procedure; restart API/workers                                     |
| Database password in `DATABASE_URL`                                    | PostgreSQL authentication                                                         | provider-defined                                                         | Provider overlap/pool restart procedure                                             |
| `BACKUP_ENCRYPTION_KEY_FILE` + `BACKUP_ENCRYPTION_KEY_VERSION`         | AES-256-CBC/PBKDF2 encryption of PostgreSQL backup generations                    | mounted chmod-600 passphrase file + non-secret version ID                | Versioned overlap for at least the full backup retention/restore-drill window       |
| `BACKUP_AUTHENTICATION_KEY_FILE` + `BACKUP_AUTHENTICATION_KEY_VERSION` | HMAC-SHA256 authentication of canonical backup manifests and ciphertext checksums | distinct mounted chmod-600 high-entropy key file + non-secret version ID | Versioned overlap for every retained manifest; rotate independently from encryption |

Production validation rejects reused encryption/signing keys, placeholders, short storage/database/SMTP credentials, non-TLS provider connections, local providers, and OpenStreetMap Foundation public tile URLs.

## Emergency session invalidation

1. Stop or restrict login/refresh traffic if compromise is active.
2. In one database transaction, revoke all refresh families and tokens and increment every user's `auth_version`:

```sql
begin;
update trail.refresh_token_families set revoked_at = coalesce(revoked_at, now());
update trail.refresh_tokens
set revoked_at = coalesce(revoked_at, now()),
    rotation_request_hash = null,
    successor_ciphertext = null,
    successor_iv = null,
    successor_tag = null,
    successor_token_id = null;
update trail.users set auth_version = auth_version + 1, updated_at = now();
commit;
```

3. Replace the affected secret in the deployment secret store, never in source or an `.env` committed to Git.
4. Restart all API and worker instances; verify `/ready` and a fresh login.
5. Confirm an old access token returns 401. Access tokens also naturally expire after 15 minutes.
6. Confirm an old refresh token returns 401 and that a new login can rotate once, retry with the same `rotation_request_id`, and rejects predecessor reuse with a different ID.

## Planned JWT signing-key rotation

The implementation accepts exactly one symmetric signing key and emits no `kid`; overlap rotation is not supported.

1. Announce a session reset. Optionally wait 15 minutes after stopping token issuance to reduce disruption.
2. Revoke refresh state and increment `auth_version` using the emergency transaction above.
3. Generate a key with a cryptographic RNG, for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
4. Update `JWT_SIGNING_KEY` in the deployment secret store and restart every instance atomically.
5. Perform the verification steps above. Users must authenticate again.

**Limitation:** adding graceful overlap requires an asymmetric or key-ring verifier with `kid`; do not attempt a rolling deployment with mixed single keys because instances will disagree about token validity.

## Refresh recovery-key rotation

1. Revoke all refresh families first (recommended) so no encrypted successor recovery is expected.
2. Generate and deploy a distinct 32-byte base64url `REFRESH_RECOVERY_KEY` to every instance atomically.
3. Restart all instances and require login again.
4. Verify refresh rotation/reuse tests.

**Limitation:** there is no key version on encrypted successor columns. Rotating without family revocation can turn a legitimate same-request retry into an authentication failure. Plain refresh tokens are never stored; SHA-256 hashes are stored.

## Email outbox-key rotation

1. Pause creation and draining of registration/password-reset email jobs.
2. Drain deliverable pending jobs with the old key, or deliberately expire/delete them and require users to request new messages.
3. Confirm no pending rows retain encrypted payloads:

```sql
select count(*) from trail.email_outbox where status = 'pending' and should_deliver;
```

4. Atomically deploy a new distinct 32-byte base64url `EMAIL_OUTBOX_KEY` and restart API/workers.
5. Resume traffic and verify registration and password-reset delivery end to end.

**Limitation:** ciphertext rows have no key version, so old and new keys cannot coexist.

## Backup encryption and authentication key lifecycle

`BACKUP_ENCRYPTION_KEY_FILE` and `BACKUP_AUTHENTICATION_KEY_FILE` are separate runtime-mounted secret files. They must never be the same file or key material and must never be committed, logged, copied into the backup destination, or placed in a container image. Their corresponding `*_VERSION` settings are non-secret immutable secret-store version identifiers. Each manifest records both versions. Restore selects both matching secret versions, verifies the HMAC-SHA256 over the canonical security-relevant fields (including ciphertext checksum and size) before trusting the manifest or touching a database, and only then verifies and decrypts the dump.

### Planned rotation and retained old keys

1. Inventory every retained manifest's `encryption_key_version` and `authentication_key_version`; verify both old key files are recoverable from the restricted secret store by version.
2. Generate high-entropy replacement material in a new immutable secret version for the key being rotated, mount it chmod 600, and update that key's file/version settings together. Never overwrite a version in place, reuse encryption material for authentication, or rotate both keys as one secret.
3. Create a backup and restore it into a new isolated database with the recorded encryption and authentication key versions. Validate representative row counts/checksums and record the drill.
4. Retain every old authentication key until no retained manifest references its version. Retain every old encryption key until all backups encrypted by it expire **and** at least one later restore drill succeeds. If retained backups are re-encrypted or re-authenticated, use temporary storage with `umask 077`, recompute the ciphertext checksum/size, generate a new HMAC with the new authentication key, verify an isolated restore, atomically replace the pair, and securely remove plaintext/transient files.
5. Delete an old key version only after an inventory proves no retained manifest references it. Key deletion is separately approved and recorded.

### Suspected compromise

Freeze backup deletion and access, revoke the compromised key version from backup writers, issue a distinct new version, and create/verify a clean backup. An encryption-key compromise makes affected backup plaintext potentially exposed. An authentication-key compromise makes affected manifests and their checksum claims forgeable; quarantine the full dump/manifest pairs and do not restore them until provenance is independently established and they are re-authenticated with a clean key. Determine access scope, follow incident/privacy notification procedures, and do not destroy old keys or evidence until incident response and tested recovery requirements authorize it.

### Restore drills

Run `scripts/ops/validate-backup-restore.sh` for every script change and a provider-realistic isolated restore at least quarterly and at every rotation. Select samples spanning every retained encryption and authentication version, fetch both matching key files by manifest version, authenticate the manifest before trusting its checksum, restore only to a new database, validate representative data, destroy the drill database, and record operator, timestamps, manifest/checksum, both key versions (never key material), RTO/RPO, results, and cleanup.

## Provider credential rotation

For database, object storage, and SMTP: create a second provider credential, grant only required permissions, deploy it, restart and verify health/one synthetic operation, then revoke the old credential. Object storage must remain private; validate that anonymous list/get/put fail and signed POST policies enforce exact owner key, MIME, byte size, and 15-minute expiry.

## Required evidence

Record timestamp, operator, affected key (never its value), provider credential identifier/version, deployment revision, revocation SQL row counts, readiness result, old-token rejection, new login/refresh result, and rollback decision. Run `pnpm --filter @trail/api test`, `pnpm --filter @trail/api typecheck`, and `pnpm audit:security` after code/dependency changes.
