#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${ADMIN_DATABASE_URL:?Set ADMIN_DATABASE_URL to an administrative connection for the same server}"
: "${RESTORE_NEW_DATABASE:?Set RESTORE_NEW_DATABASE to a database name that does not exist}"
: "${BACKUP_MANIFEST:?Set BACKUP_MANIFEST to a generated manifest.json file}"
: "${BACKUP_ENCRYPTION_KEY_FILE:?Set BACKUP_ENCRYPTION_KEY_FILE to the backup passphrase file}"
: "${BACKUP_ENCRYPTION_KEY_VERSION:?Set BACKUP_ENCRYPTION_KEY_VERSION to the encryption version recorded by the manifest}"
: "${BACKUP_AUTHENTICATION_KEY_FILE:?Set BACKUP_AUTHENTICATION_KEY_FILE to the distinct manifest HMAC key file}"
: "${BACKUP_AUTHENTICATION_KEY_VERSION:?Set BACKUP_AUTHENTICATION_KEY_VERSION to the authentication version recorded by the manifest}"

for command in psql createdb dropdb pg_restore openssl sha256sum sed stat node cmp; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
[[ "$RESTORE_NEW_DATABASE" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]] || { echo "Unsafe database name" >&2; exit 1; }
[[ -f "$BACKUP_MANIFEST" && ! -L "$BACKUP_MANIFEST" ]] || { echo "Manifest file must be a regular non-symlink file" >&2; exit 1; }
validate_key_file() {
  local label="$1" path="$2" mode
  [[ -f "$path" && ! -L "$path" ]] || { echo "$label key file must be a regular non-symlink file" >&2; exit 1; }
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & 077) == 0 && (8#$mode & 400) != 0 )) || { echo "$label key file must be owner-readable with no group/other permissions" >&2; exit 1; }
  [[ -s "$path" ]] || { echo "$label key file must not be empty" >&2; exit 1; }
}
validate_key_file Encryption "$BACKUP_ENCRYPTION_KEY_FILE"
validate_key_file Authentication "$BACKUP_AUTHENTICATION_KEY_FILE"
[[ ! "$BACKUP_ENCRYPTION_KEY_FILE" -ef "$BACKUP_AUTHENTICATION_KEY_FILE" ]] && ! cmp -s "$BACKUP_ENCRYPTION_KEY_FILE" "$BACKUP_AUTHENTICATION_KEY_FILE" || { echo "Backup encryption and authentication keys must be distinct material in separate files" >&2; exit 1; }

manifest_line="$(cat "$BACKUP_MANIFEST")"
manifest_version="$(sed -n 's/.*"manifest_version":\([0-9]*\).*/\1/p' "$BACKUP_MANIFEST")"
format="$(sed -n 's/.*"format":"\([A-Za-z0-9+._-]*\)".*/\1/p' "$BACKUP_MANIFEST")"
created_at="$(sed -n 's/.*"created_at_utc":"\([0-9TZ.]*\)".*/\1/p' "$BACKUP_MANIFEST")"
backup_file_name="$(sed -n 's/.*"file":"\([^"]*\)".*/\1/p' "$BACKUP_MANIFEST")"
expected_checksum="$(sed -n 's/.*"sha256":"\([0-9a-f]*\)".*/\1/p' "$BACKUP_MANIFEST")"
expected_size="$(sed -n 's/.*"bytes":\([0-9]*\).*/\1/p' "$BACKUP_MANIFEST")"
manifest_encryption_version="$(sed -n 's/.*"encryption_key_version":"\([A-Za-z0-9._-]*\)".*/\1/p' "$BACKUP_MANIFEST")"
authentication="$(sed -n 's/.*"authentication":"\([A-Za-z0-9-]*\)".*/\1/p' "$BACKUP_MANIFEST")"
manifest_authentication_version="$(sed -n 's/.*"authentication_key_version":"\([A-Za-z0-9._-]*\)".*/\1/p' "$BACKUP_MANIFEST")"
claimed_hmac="$(sed -n 's/.*"hmac_sha256":"\([0-9a-f]*\)".*/\1/p' "$BACKUP_MANIFEST")"
[[ "$manifest_version" == 1 && "$format" == 'pg_dump-custom+aes-256-cbc-pbkdf2' && "$created_at" =~ ^[0-9]{8}T[0-9]{6}\.[0-9]{9}Z$ ]] || { echo "Invalid manifest format or version" >&2; exit 1; }
[[ "$backup_file_name" =~ ^trail-postgres-[0-9]{8}T[0-9]{6}\.[0-9]{9}Z-[0-9a-f]{16}\.dump\.enc$ && "$expected_checksum" =~ ^[0-9a-f]{64}$ && "$expected_size" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid manifest backup identity" >&2; exit 1; }
[[ "$manifest_encryption_version" =~ ^[A-Za-z0-9._-]{1,64}$ && "$authentication" == hmac-sha256 && "$manifest_authentication_version" =~ ^[A-Za-z0-9._-]{1,64}$ && "$claimed_hmac" =~ ^[0-9a-f]{64}$ ]] || { echo "Invalid manifest authentication fields" >&2; exit 1; }
canonical="$(mktemp)"
trap 'rm -f "$canonical"' EXIT INT TERM
printf 'manifest_version=%s\nformat=%s\ncreated_at_utc=%s\nfile=%s\nsha256=%s\nbytes=%s\nencryption_key_version=%s\nauthentication=%s\nauthentication_key_version=%s\n' \
  "$manifest_version" "$format" "$created_at" "$backup_file_name" "$expected_checksum" "$expected_size" "$manifest_encryption_version" "$authentication" "$manifest_authentication_version" > "$canonical"
if ! node "$script_dir/backup-manifest-hmac.mjs" "$BACKUP_AUTHENTICATION_KEY_FILE" "$canonical" "$claimed_hmac"; then
  echo "Backup manifest authentication failed" >&2
  exit 1
fi
expected_manifest="$(printf '{"manifest_version":%s,"format":"%s","created_at_utc":"%s","file":"%s","sha256":"%s","bytes":%s,"encryption_key_version":"%s","authentication":"%s","authentication_key_version":"%s","hmac_sha256":"%s"}' \
  "$manifest_version" "$format" "$created_at" "$backup_file_name" "$expected_checksum" "$expected_size" "$manifest_encryption_version" "$authentication" "$manifest_authentication_version" "$claimed_hmac")"
[[ "$manifest_line" == "$expected_manifest" ]] || { echo "Manifest contains unexpected or duplicate fields" >&2; exit 1; }
rm -f "$canonical"
trap - EXIT INT TERM

[[ "$manifest_authentication_version" == "$BACKUP_AUTHENTICATION_KEY_VERSION" ]] || { echo "Backup authentication key version mismatch: manifest requires $manifest_authentication_version" >&2; exit 1; }
[[ "$manifest_encryption_version" == "$BACKUP_ENCRYPTION_KEY_VERSION" ]] || { echo "Backup encryption key version mismatch: manifest requires $manifest_encryption_version" >&2; exit 1; }
backup_file="$(dirname "$BACKUP_MANIFEST")/$backup_file_name"
[[ -f "$backup_file" && ! -L "$backup_file" ]] || { echo "Encrypted backup must be a regular non-symlink file" >&2; exit 1; }
actual_checksum="$(sha256sum "$backup_file" | awk '{print $1}')"
actual_size="$(wc -c < "$backup_file" | tr -d ' ')"
[[ "$actual_checksum" == "$expected_checksum" && "$actual_size" == "$expected_size" ]] || { echo "Authenticated backup checksum or size mismatch" >&2; exit 1; }

exists="$(psql "$ADMIN_DATABASE_URL" -XAt --set=ON_ERROR_STOP=1 --set=db="$RESTORE_NEW_DATABASE" <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'db';
SQL
)"
[[ -z "$exists" ]] || { echo "Refusing to overwrite existing database: $RESTORE_NEW_DATABASE" >&2; exit 1; }

created=false
complete=false
cleanup() {
  if [[ "$created" == true && "$complete" != true ]]; then
    echo "Restore failed; removing only newly-created database $RESTORE_NEW_DATABASE" >&2
    if ! dropdb --maintenance-db="$ADMIN_DATABASE_URL" --if-exists "$RESTORE_NEW_DATABASE"; then
      echo "Restore cleanup also failed; operator action is required for $RESTORE_NEW_DATABASE" >&2
    fi
  fi
}
trap cleanup EXIT INT TERM
createdb --maintenance-db="$ADMIN_DATABASE_URL" "$RESTORE_NEW_DATABASE"
created=true
restore_url="${ADMIN_DATABASE_URL%%\?*}"
query=""
[[ "$ADMIN_DATABASE_URL" == *\?* ]] && query="?${ADMIN_DATABASE_URL#*\?}"
restore_url="${restore_url%/*}/${RESTORE_NEW_DATABASE}${query}"
openssl enc -d -aes-256-cbc -pbkdf2 -in "$backup_file" -pass "file:$BACKUP_ENCRYPTION_KEY_FILE" |
  pg_restore --dbname="$restore_url" --no-owner --no-privileges --exit-on-error
complete=true
trap - EXIT INT TERM
printf 'Restored into new database: %s\n' "$RESTORE_NEW_DATABASE"
