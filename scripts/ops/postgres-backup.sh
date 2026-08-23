#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${DATABASE_URL:?Set DATABASE_URL to the source PostgreSQL database}"
: "${BACKUP_DESTINATION:?Set BACKUP_DESTINATION to an encrypted-at-rest destination directory}"
: "${BACKUP_ENCRYPTION_KEY_FILE:?Set BACKUP_ENCRYPTION_KEY_FILE to a chmod 600 file containing a strong passphrase}"
: "${BACKUP_ENCRYPTION_KEY_VERSION:?Set BACKUP_ENCRYPTION_KEY_VERSION to the secret-store key version identifier}"
: "${BACKUP_AUTHENTICATION_KEY_FILE:?Set BACKUP_AUTHENTICATION_KEY_FILE to a distinct chmod 600 HMAC key file}"
: "${BACKUP_AUTHENTICATION_KEY_VERSION:?Set BACKUP_AUTHENTICATION_KEY_VERSION to the authentication key version identifier}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

for command in pg_dump openssl sha256sum stat find ln node cmp; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
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
[[ "$BACKUP_ENCRYPTION_KEY_VERSION" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "BACKUP_ENCRYPTION_KEY_VERSION must be a safe secret-store version identifier" >&2; exit 1; }
[[ "$BACKUP_AUTHENTICATION_KEY_VERSION" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "BACKUP_AUTHENTICATION_KEY_VERSION must be a safe secret-store version identifier" >&2; exit 1; }
[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "BACKUP_RETENTION_DAYS must be a non-negative integer" >&2; exit 1; }
mkdir -p "$BACKUP_DESTINATION"

# The random suffix, not timestamp precision, provides collision resistance.
stamp="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%S).000000000Z}"
suffix="${BACKUP_ID_SUFFIX:-$(openssl rand -hex 8)}"
[[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}\.[0-9]{9}Z$ ]] || { echo "BACKUP_TIMESTAMP must be a UTC timestamp with nanoseconds" >&2; exit 1; }
[[ "$suffix" =~ ^[0-9a-f]{16}$ ]] || { echo "BACKUP_ID_SUFFIX must be exactly 16 lowercase hexadecimal characters" >&2; exit 1; }
base="trail-postgres-${stamp}-${suffix}"
reservation="${BACKUP_DESTINATION}/.${base}.publishing"
dump_path="${BACKUP_DESTINATION}/${base}.dump.enc"
manifest_path="${BACKUP_DESTINATION}/${base}.manifest.json"
mkdir "$reservation" 2>/dev/null || { echo "Backup name collision: $base" >&2; exit 1; }
tmp_dump="${reservation}/dump"
tmp_encrypted="${reservation}/dump.enc"
tmp_canonical="${reservation}/manifest.canonical"
tmp_manifest="${reservation}/manifest.json"
published_dump=false
cleanup() {
  rm -f "$tmp_dump" "$tmp_encrypted" "$tmp_canonical" "$tmp_manifest"
  if [[ -d "$reservation" ]] && ! rmdir "$reservation"; then
    echo "Backup cleanup could not remove reservation directory: $reservation" >&2
  fi
  if [[ "$published_dump" == true && ! -f "$manifest_path" ]]; then rm -f "$dump_path"; fi
}
trap cleanup EXIT INT TERM

pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$tmp_dump"
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$tmp_dump" -out "$tmp_encrypted" -pass "file:$BACKUP_ENCRYPTION_KEY_FILE"
checksum="$(sha256sum "$tmp_encrypted" | awk '{print $1}')"
size="$(wc -c < "$tmp_encrypted" | tr -d ' ')"
format='pg_dump-custom+aes-256-cbc-pbkdf2'
authentication='hmac-sha256'
manifest_version='1'
printf 'manifest_version=%s\nformat=%s\ncreated_at_utc=%s\nfile=%s.dump.enc\nsha256=%s\nbytes=%s\nencryption_key_version=%s\nauthentication=%s\nauthentication_key_version=%s\n' \
  "$manifest_version" "$format" "$stamp" "$base" "$checksum" "$size" "$BACKUP_ENCRYPTION_KEY_VERSION" "$authentication" "$BACKUP_AUTHENTICATION_KEY_VERSION" > "$tmp_canonical"
hmac="$(node "$script_dir/backup-manifest-hmac.mjs" "$BACKUP_AUTHENTICATION_KEY_FILE" "$tmp_canonical")"
[[ "$hmac" =~ ^[0-9a-f]{64}$ ]] || { echo "Failed to authenticate backup manifest" >&2; exit 1; }
printf '{"manifest_version":%s,"format":"%s","created_at_utc":"%s","file":"%s.dump.enc","sha256":"%s","bytes":%s,"encryption_key_version":"%s","authentication":"%s","authentication_key_version":"%s","hmac_sha256":"%s"}\n' \
  "$manifest_version" "$format" "$stamp" "$base" "$checksum" "$size" "$BACKUP_ENCRYPTION_KEY_VERSION" "$authentication" "$BACKUP_AUTHENTICATION_KEY_VERSION" "$hmac" > "$tmp_manifest"
[[ ! -e "$dump_path" && ! -e "$manifest_path" ]] || { echo "Refusing to overwrite an existing backup pair" >&2; exit 1; }
ln "$tmp_encrypted" "$dump_path" || { echo "Failed to publish encrypted dump without overwrite" >&2; exit 1; }
rm -f "$tmp_encrypted"
published_dump=true
ln "$tmp_manifest" "$manifest_path" || { echo "Failed to publish manifest without overwrite" >&2; exit 1; }
rm -f "$tmp_manifest"
published_dump=false
rm -f "$tmp_dump" "$tmp_canonical"

while IFS= read -r -d '' old_manifest; do
  old_dump="${old_manifest%.manifest.json}.dump.enc"
  [[ -f "$old_dump" ]] && rm -f "$old_dump" "$old_manifest"
done < <(find "$BACKUP_DESTINATION" -maxdepth 1 -type f -name 'trail-postgres-*.manifest.json' -mtime "+$BACKUP_RETENTION_DAYS" -print0)
printf '%s\n' "$manifest_path"
