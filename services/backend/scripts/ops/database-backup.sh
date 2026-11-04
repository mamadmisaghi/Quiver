#!/usr/bin/env bash
# Run from a trusted shell with a PostgreSQL client matching the database's major version.
set -euo pipefail
umask 077
operation="${1:-}"
archive="${2:-}"
[[ -n "$archive" ]] || { echo 'Usage: database-backup.sh backup|restore ARCHIVE' >&2; exit 2; }
connect_database() {
  local -a parts
  mapfile -d '' -t parts < <(QUIVER_BACKUP_CONNECTION="$1" node --input-type=module -e '
    const u=new URL(process.env.QUIVER_BACKUP_CONNECTION);
    if(!["postgres:","postgresql:"].includes(u.protocol) || !u.hostname || !u.pathname.slice(1))process.exit(2);
    const values=[u.hostname,u.port||"5432",decodeURIComponent(u.pathname.slice(1)),decodeURIComponent(u.username),decodeURIComponent(u.password),u.searchParams.get("sslmode")||process.env.PGSSLMODE||"prefer"];
    for(const v of values)process.stdout.write(v+"\0");')
  (( ${#parts[@]} == 6 )) || { echo 'Invalid database connection.' >&2; exit 2; }
  export PGHOST="${parts[0]}" PGPORT="${parts[1]}" PGDATABASE="${parts[2]}" PGUSER="${parts[3]}" PGPASSWORD="${parts[4]}" PGSSLMODE="${parts[5]}"
}
case "$operation" in
  backup)
    : "${DATABASE_URL:?Set DATABASE_URL in the environment}"
    [[ ! -e "$archive" ]] || { echo 'Choose a new archive path.' >&2; exit 2; }
    temporary="$(mktemp "${archive}.XXXXXX")"
    trap 'rm -f -- "$temporary"' EXIT
    connect_database "$DATABASE_URL"
    pg_dump --format=custom --no-owner --no-privileges --file="$temporary"
    pg_restore --list "$temporary" >/dev/null
    ln -- "$temporary" "$archive"
    echo 'Archive created and its catalog verified.'
    ;;
  restore)
    : "${QUIVER_EMPTY_RESTORE_URL:?Set the connection to a new empty database}"
    [[ -f "$archive" ]] || { echo 'Archive missing.' >&2; exit 2; }
    connect_database "$QUIVER_EMPTY_RESTORE_URL"
    tables="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")"
    [[ "$tables" = "0" ]] || { echo 'Restore requires a new, empty database.' >&2; exit 2; }
    # Restore and fence execution in one transaction. A worker must never resume from a stale backup.
    staging="$(mktemp)"
    trap 'rm -f -- "$staging"' EXIT
    pg_restore --no-owner --no-privileges --file="$staging" "$archive"
    printf '\n%s\n' "UPDATE quiver_state SET payload=jsonb_set(payload,'{restoreHold}','true'::jsonb) WHERE id='paper-beta';" >> "$staging"
    psql -Xq --single-transaction -v ON_ERROR_STOP=1 --file="$staging" >/dev/null
    echo 'Restored into the recovery database. Signers and sessions will be held on first boot.'
    ;;
  *) echo 'Choose backup or restore.' >&2; exit 2 ;;
esac
