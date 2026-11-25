#!/usr/bin/env bash
# Applies Supabase migrations to a throwaway local Postgres and runs RLS tests.
# Requires PostgreSQL 15+ binaries (initdb, pg_ctl, psql). Set PG_BIN if they are not on PATH.
# Postgres refuses to run as root; when run as root, the server runs as an existing
# unprivileged account (RLS_PG_OS_USER, default "nobody").
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="${PG_BIN}:$PATH"
TMP="$(mktemp -d)"
PORT="${RLS_PG_PORT:-54329}"

RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  OS_USER="${RLS_PG_OS_USER:-nobody}"
  chown "$OS_USER" "$TMP"
  RUN_AS=(runuser -u "$OS_USER" --)
fi

cleanup() { "${RUN_AS[@]}" pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

"${RUN_AS[@]}" initdb -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/data/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -d postgres)

"${PSQL[@]}" -f "$ROOT/tests/rls/supabase_auth_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -o /dev/null -f "$ROOT/tests/rls/rls_test.sql"
