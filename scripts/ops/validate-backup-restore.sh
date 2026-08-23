#!/usr/bin/env bash
set -euo pipefail

local_test_database_url='postgres://trail:trail_local_only'
local_test_database_url+='@127.0.0.1:5433/postgres'
: "${ADMIN_DATABASE_URL:=$local_test_database_url}"
prefix="trail_backup_validation_${$}"
source_db="${prefix}_source"
restore_db="${prefix}_restore"
rotation_db="${prefix}_rotation"
failure_db="${prefix}_failure"
work_dir="${BACKUP_VALIDATION_WORK_DIR:-$(mktemp -d)}"
mkdir -p "$work_dir"
encryption_key_file="$work_dir/encryption-key"
wrong_encryption_key_file="$work_dir/wrong-encryption-key"
authentication_key_file="$work_dir/authentication-key"
wrong_authentication_key_file="$work_dir/wrong-authentication-key"
rotated_authentication_key_file="$work_dir/rotated-authentication-key"
cleanup() {
  for database in "$source_db" "$restore_db" "$rotation_db" "$failure_db"; do
    if ! dropdb --maintenance-db="$ADMIN_DATABASE_URL" --if-exists "$database"; then
      echo "Warning: could not remove backup validation database $database" >&2
    fi
  done
  rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM

for database in "$source_db" "$restore_db" "$rotation_db" "$failure_db"; do
  dropdb --maintenance-db="$ADMIN_DATABASE_URL" --if-exists "$database"
done
createdb --maintenance-db="$ADMIN_DATABASE_URL" "$source_db"
base="${ADMIN_DATABASE_URL%%\?*}"
query=""
[[ "$ADMIN_DATABASE_URL" == *\?* ]] && query="?${ADMIN_DATABASE_URL#*\?}"
source_url="${base%/*}/${source_db}${query}"
psql "$source_url" -X --set=ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA synthetic;
CREATE TABLE synthetic.backup_probe (id integer PRIMARY KEY, label text NOT NULL, sensitive_coordinate point);
INSERT INTO synthetic.backup_probe VALUES (1, 'synthetic-only', point(12.34, 56.78)), (2, 'checksum-probe', point(-1, -2));
SQL
printf 'local-validation-encryption-passphrase-not-for-provider-use\n' > "$encryption_key_file"
printf 'deliberately-wrong-local-encryption-passphrase\n' > "$wrong_encryption_key_file"
printf 'local-validation-independent-hmac-key-material\n' > "$authentication_key_file"
printf 'deliberately-wrong-local-hmac-key-material\n' > "$wrong_authentication_key_file"
printf 'rotated-local-hmac-key-material\n' > "$rotated_authentication_key_file"
chmod 600 "$encryption_key_file" "$wrong_encryption_key_file" "$authentication_key_file" "$wrong_authentication_key_file" "$rotated_authentication_key_file"
backup_env=(DATABASE_URL="$source_url" BACKUP_DESTINATION="$work_dir/backups" BACKUP_ENCRYPTION_KEY_FILE="$encryption_key_file" BACKUP_ENCRYPTION_KEY_VERSION=encryption-v1 BACKUP_AUTHENTICATION_KEY_FILE="$authentication_key_file" BACKUP_AUTHENTICATION_KEY_VERSION=authentication-v1 BACKUP_RETENTION_DAYS=14)
restore_env=(ADMIN_DATABASE_URL="$ADMIN_DATABASE_URL" BACKUP_ENCRYPTION_KEY_FILE="$encryption_key_file" BACKUP_ENCRYPTION_KEY_VERSION=encryption-v1 BACKUP_AUTHENTICATION_KEY_FILE="$authentication_key_file" BACKUP_AUTHENTICATION_KEY_VERSION=authentication-v1)
env "${backup_env[@]}" bash scripts/ops/postgres-backup.sh >/dev/null
manifest="$(find "$work_dir/backups" -name '*.manifest.json' -type f | head -n 1)"
backup_file_name="$(sed -n 's/.*"file":"\([^"]*\)".*/\1/p' "$manifest")"
backup_file="$work_dir/backups/$backup_file_name"

assert_restore_rejected() {
  local message="$1"
  shift
  dropdb --maintenance-db="$ADMIN_DATABASE_URL" --if-exists "$failure_db" >/dev/null
  if env "${restore_env[@]}" RESTORE_NEW_DATABASE="$failure_db" BACKUP_MANIFEST="$manifest" "$@" bash scripts/ops/postgres-restore-new.sh >/dev/null 2>&1; then
    echo "$message" >&2
    exit 1
  fi
  local exists
  exists="$(psql "$ADMIN_DATABASE_URL" -XAt --set=ON_ERROR_STOP=1 --set=db="$failure_db" <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'db';
SQL
)"
  [[ -z "$exists" ]] || { echo 'Rejected restore created or retained a database' >&2; exit 1; }
}

env "${restore_env[@]}" RESTORE_NEW_DATABASE="$restore_db" BACKUP_MANIFEST="$manifest" bash scripts/ops/postgres-restore-new.sh >/dev/null
restore_url="${base%/*}/${restore_db}${query}"
result="$(psql "$restore_url" -XAt --set=ON_ERROR_STOP=1 -c "SELECT count(*) || ':' || string_agg(label, ',' ORDER BY id) FROM synthetic.backup_probe")"
[[ "$result" == '2:synthetic-only,checksum-probe' ]] || { echo "Restored synthetic data mismatch: $result" >&2; exit 1; }
assert_restore_rejected 'Existing database restore was accepted' RESTORE_NEW_DATABASE="$restore_db"

cp "$backup_file" "$work_dir/original.dump.enc"
cp "$manifest" "$work_dir/original.manifest.json"
printf 'attacker-controlled-ciphertext' >> "$backup_file"
attacker_checksum="$(sha256sum "$backup_file" | awk '{print $1}')"
attacker_size="$(wc -c < "$backup_file" | tr -d ' ')"
sed -i "s/\"sha256\":\"[0-9a-f]*\"/\"sha256\":\"$attacker_checksum\"/; s/\"bytes\":[0-9]*/\"bytes\":$attacker_size/" "$manifest"
assert_restore_rejected 'Attacker-modified ciphertext and checksum were accepted without a valid HMAC'
cp "$work_dir/original.dump.enc" "$backup_file"
cp "$work_dir/original.manifest.json" "$manifest"
sed -i 's/"created_at_utc":"[^"]*"/"created_at_utc":"19990101T000000.000000000Z"/' "$manifest"
assert_restore_rejected 'Security-relevant manifest tampering was accepted without a valid HMAC'
cp "$work_dir/original.manifest.json" "$manifest"
assert_restore_rejected 'Wrong authentication key was accepted' BACKUP_AUTHENTICATION_KEY_FILE="$wrong_authentication_key_file"
assert_restore_rejected 'Wrong authentication key version was accepted' BACKUP_AUTHENTICATION_KEY_VERSION=authentication-v2
assert_restore_rejected 'Wrong encryption key was accepted' BACKUP_ENCRYPTION_KEY_FILE="$wrong_encryption_key_file"

rotation_manifest="$(env "${backup_env[@]}" BACKUP_AUTHENTICATION_KEY_FILE="$rotated_authentication_key_file" BACKUP_AUTHENTICATION_KEY_VERSION=authentication-v2 bash scripts/ops/postgres-backup.sh)"
env "${restore_env[@]}" RESTORE_NEW_DATABASE="$rotation_db" BACKUP_MANIFEST="$rotation_manifest" BACKUP_AUTHENTICATION_KEY_FILE="$rotated_authentication_key_file" BACKUP_AUTHENTICATION_KEY_VERSION=authentication-v2 bash scripts/ops/postgres-restore-new.sh >/dev/null
manifest="$rotation_manifest"
assert_restore_rejected 'Pre-rotation authentication key was accepted for a rotated manifest'
manifest="${backup_file%.dump.enc}.manifest.json"

before_count="$(find "$work_dir/backups" -name '*.manifest.json' -type f | wc -l | tr -d ' ')"
env "${backup_env[@]}" bash scripts/ops/postgres-backup.sh >/dev/null &
first_pid=$!
env "${backup_env[@]}" bash scripts/ops/postgres-backup.sh >/dev/null &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
after_count="$(find "$work_dir/backups" -name '*.manifest.json' -type f | wc -l | tr -d ' ')"
[[ "$after_count" -eq $((before_count + 2)) ]] || { echo 'Simultaneous backups did not publish two unique pairs' >&2; exit 1; }

collision_stamp='20000101T000000.000000000Z'
collision_suffix='0123456789abcdef'
env "${backup_env[@]}" BACKUP_TIMESTAMP="$collision_stamp" BACKUP_ID_SUFFIX="$collision_suffix" bash scripts/ops/postgres-backup.sh >/dev/null
if env "${backup_env[@]}" BACKUP_TIMESTAMP="$collision_stamp" BACKUP_ID_SUFFIX="$collision_suffix" bash scripts/ops/postgres-backup.sh >/dev/null 2>&1; then
  echo 'Backup collision overwrote an existing pair' >&2
  exit 1
fi
collision_manifest="$work_dir/backups/trail-postgres-${collision_stamp}-${collision_suffix}.manifest.json"
collision_dump="$work_dir/backups/trail-postgres-${collision_stamp}-${collision_suffix}.dump.enc"
expired_touch_time="$(date -u -d "@$(( $(date +%s) - 2592000 ))" +%Y%m%d%H%M.%S)"
touch -t "$expired_touch_time" "$collision_manifest" "$collision_dump"
orphan_dump="$work_dir/backups/trail-postgres-20000101T000001.000000000Z-1123456789abcdef.dump.enc"
orphan_manifest="$work_dir/backups/trail-postgres-20000101T000002.000000000Z-2123456789abcdef.manifest.json"
printf 'orphan' > "$orphan_dump"
printf '{}\n' > "$orphan_manifest"
touch -t "$expired_touch_time" "$orphan_dump" "$orphan_manifest"
env "${backup_env[@]}" bash scripts/ops/postgres-backup.sh >/dev/null
[[ ! -e "$collision_manifest" && ! -e "$collision_dump" ]] || { echo 'Expired backup pair was not removed together' >&2; exit 1; }
[[ -e "$orphan_dump" && -e "$orphan_manifest" ]] || { echo 'Retention deleted an unpaired artifact' >&2; exit 1; }

chmod 644 "$wrong_authentication_key_file"
if env "${backup_env[@]}" BACKUP_AUTHENTICATION_KEY_FILE="$wrong_authentication_key_file" bash scripts/ops/postgres-backup.sh >/dev/null 2>&1; then
  echo 'Backup accepted an over-permissive authentication key file' >&2
  exit 1
fi
if env "${backup_env[@]}" BACKUP_AUTHENTICATION_KEY_FILE="$encryption_key_file" bash scripts/ops/postgres-backup.sh >/dev/null 2>&1; then
  echo 'Backup accepted the encryption key file as its authentication key' >&2
  exit 1
fi
copied_encryption_key_file="$work_dir/copied-encryption-key"
cp "$encryption_key_file" "$copied_encryption_key_file"
chmod 600 "$copied_encryption_key_file"
if env "${backup_env[@]}" BACKUP_AUTHENTICATION_KEY_FILE="$copied_encryption_key_file" bash scripts/ops/postgres-backup.sh >/dev/null 2>&1; then
  echo 'Backup accepted duplicated encryption material as its authentication key' >&2
  exit 1
fi
printf 'Backup/restore validation passed (authenticated manifests, key rotation, atomic pairs, failures, collisions, concurrency, retention).\n'
