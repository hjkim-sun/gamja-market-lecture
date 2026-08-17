#!/usr/bin/env bash
# Contract tests for the local Docker PostgreSQL development controller.
# Run: bash tests/db-local.test.sh
#
# The integration portion is deliberately opt-in by capability: it runs when a
# usable Docker daemon is present and otherwise leaves the host untouched.

set -u -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_SCRIPT="$ROOT_DIR/scripts/db-local.sh"
COMPOSE_FILE="$ROOT_DIR/docker-compose.local.yml"
MIGRATIONS_DIR="$ROOT_DIR/backend/supabase/migrations"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/gamja-db-local.XXXXXX")"
FAKE_BIN="$TEST_TMP/bin"
FAKE_DOCKER_LOG="$TEST_TMP/docker-calls.log"
FAILURES=0
TEST_PROJECT="gamja_db_local_test_${$}"
TEST_PORT="$(python3 - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
TEST_DATABASE_URL="postgresql://test-user:db-local-test-secret@127.0.0.1:${TEST_PORT}/gamja_market"
DOCKER_INTEGRATION=0
DB_SERVICE=''

cleanup() {
  # This exact, unique project name is the only Docker resource namespace this
  # test creates.  Never use a bare `docker volume rm` or `docker compose down`.
  if (( DOCKER_INTEGRATION )); then
    COMPOSE_PROJECT_NAME="$TEST_PROJECT" POSTGRES_PORT="$TEST_PORT" \
      docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$TEST_TMP"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  FAILURES=$((FAILURES + 1))
}

assert_file() {
  [[ -f "$1" ]] || fail "expected file to exist: $1"
}

assert_contains() {
  local needle="$1" file="$2" description="$3"
  grep -F -- "$needle" "$file" >/dev/null 2>&1 || fail "$description (missing '$needle')"
}

assert_not_contains() {
  local needle="$1" file="$2" description="$3"
  if [[ -f "$file" ]] && grep -F -- "$needle" "$file" >/dev/null 2>&1; then
    fail "$description (unexpected '$needle')"
  fi
}

assert_eq() {
  local actual="$1" expected="$2" description="$3"
  [[ "$actual" == "$expected" ]] || fail "$description (expected '$expected', got '$actual')"
}

portable_migration_count() {
  find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' \
    ! -name '20260816121000_create_profiles_auth_layer.sql' \
    ! -name '20260817100000_create_image_storage_buckets.sql' | wc -l | tr -d ' '
}

write_fake_docker() {
  mkdir -p "$FAKE_BIN"
  cat > "$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DB_LOCAL_TEST_DOCKER_LOG:?}"
printf 'docker must not be invoked for an invalid db-local command\n' >&2
exit 97
EOF
  chmod +x "$FAKE_BIN/docker"
}

run_unknown_command() {
  PATH="$FAKE_BIN:$PATH" \
    DB_LOCAL_TEST_DOCKER_LOG="$FAKE_DOCKER_LOG" \
    DATABASE_URL="$TEST_DATABASE_URL" \
    "$DB_SCRIPT" not-a-db-local-command >"$TEST_TMP/unknown.out" 2>&1
}

run_local_db() {
  COMPOSE_PROJECT_NAME="$TEST_PROJECT" \
    POSTGRES_PORT="$TEST_PORT" \
    DATABASE_URL="$TEST_DATABASE_URL" \
    "$DB_SCRIPT" "$@" >"$TEST_TMP/$1.out" 2>&1
}

compose_psql() {
  local sql="$1"
  COMPOSE_PROJECT_NAME="$TEST_PROJECT" POSTGRES_PORT="$TEST_PORT" \
    docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" \
      psql -U postgres -d gamja_market -At -c "$sql"
}

docker_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

assert_file "$DB_SCRIPT"
assert_file "$COMPOSE_FILE"

if [[ -f "$DB_SCRIPT" ]]; then
  if ! bash -n "$DB_SCRIPT"; then
    fail "scripts/db-local.sh must pass bash syntax validation"
  fi

  # Invalid input must be rejected before any Docker command, and neither the
  # caller's DATABASE_URL nor its password may be echoed in the error path.
  write_fake_docker
  : > "$FAKE_DOCKER_LOG"
  if run_unknown_command; then
    fail "an unknown db-local subcommand must exit non-zero"
  fi
  assert_contains 'unknown' "$TEST_TMP/unknown.out" \
    "unknown subcommand error must be clear"
  assert_not_contains "$TEST_DATABASE_URL" "$TEST_TMP/unknown.out" \
    "unknown-command output must not expose DATABASE_URL"
  assert_not_contains 'db-local-test-secret' "$TEST_TMP/unknown.out" \
    "unknown-command output must not expose a password"
  if [[ -s "$FAKE_DOCKER_LOG" ]]; then
    fail "an unknown subcommand must not invoke Docker"
  fi
fi

if command -v docker >/dev/null 2>&1; then
  if [[ -f "$COMPOSE_FILE" ]]; then
    if ! COMPOSE_PROJECT_NAME="$TEST_PROJECT" POSTGRES_PORT="$TEST_PORT" \
      docker compose -f "$COMPOSE_FILE" config --quiet >"$TEST_TMP/compose-config.out" 2>&1; then
      fail "docker-compose.local.yml must pass docker compose config --quiet"
    fi
  fi
else
  printf 'SKIP: Docker CLI is unavailable; compose syntax and database integration checks skipped.\n'
fi

if docker_available && [[ -f "$DB_SCRIPT" && -f "$COMPOSE_FILE" ]]; then
  DOCKER_INTEGRATION=1
  DB_SERVICE="$(COMPOSE_PROJECT_NAME="$TEST_PROJECT" POSTGRES_PORT="$TEST_PORT" \
    docker compose -f "$COMPOSE_FILE" config --services 2>/dev/null | head -n 1)"
  if [[ -z "$DB_SERVICE" ]]; then
    fail "docker-compose.local.yml must define a PostgreSQL service"
  fi

  if ! run_local_db up; then
    fail "db-local up must start a fresh local database and apply migrations"
  fi
  assert_not_contains "$TEST_DATABASE_URL" "$TEST_TMP/up.out" \
    "up output must not expose DATABASE_URL"
  assert_not_contains 'db-local-test-secret' "$TEST_TMP/up.out" \
    "up output must not expose a password"

  if ! compose_psql "select 1" >"$TEST_TMP/psql-ready.out" 2>&1; then
    fail "db-local up must leave the postgres service ready for connections"
  fi

  role_count="$(compose_psql "select count(*) from pg_roles where rolname in ('anon', 'authenticated')" 2>/dev/null || true)"
  assert_eq "$role_count" '2' "migrations must create anon and authenticated role stubs"

  expected_migrations="$(portable_migration_count)"
  ledger_table="$(compose_psql "select quote_ident(table_schema) || '.' || quote_ident(table_name) from information_schema.tables where table_type = 'BASE TABLE' and table_name = 'applied_migrations' order by table_schema limit 1" 2>/dev/null || true)"
  if [[ -z "$ledger_table" ]]; then
    fail "migrations must record applied filenames in an applied_migrations ledger"
  else
    applied_count="$(compose_psql "select count(*) from ${ledger_table}" 2>/dev/null || true)"
    assert_eq "$applied_count" "$expected_migrations" \
      "fresh database must apply every portable migration exactly once"
  fi

  schema_tables="$(compose_psql "select tablename from pg_tables where schemaname = 'public' and tablename in ('app_users', 'auth_sessions', 'purchase_requests', 'request_applications', 'chat_threads', 'chat_messages', 'request_images', 'application_images') order by tablename" 2>/dev/null || true)"
  for required_table in app_users auth_sessions purchase_requests request_applications chat_threads chat_messages request_images application_images; do
    if ! printf '%s\n' "$schema_tables" | grep -Fx -- "$required_table" >/dev/null; then
      fail "portable schema must contain public.${required_table}"
    fi
  done

  profiles_present="$(compose_psql "select count(*) from pg_tables where schemaname = 'public' and tablename = 'profiles'" 2>/dev/null || true)"
  assert_eq "$profiles_present" '0' "auth-dependent profiles migration must be excluded"
  storage_schema_present="$(compose_psql "select count(*) from information_schema.schemata where schema_name = 'storage'" 2>/dev/null || true)"
  assert_eq "$storage_schema_present" '0' "storage-dependent migration must be excluded"

  if ! run_local_db migrate; then
    fail "db-local migrate must be idempotent on an initialized database"
  fi
  if [[ -n "$ledger_table" ]]; then
    applied_count_after_retry="$(compose_psql "select count(*) from ${ledger_table}" 2>/dev/null || true)"
    assert_eq "$applied_count_after_retry" "$expected_migrations" \
      "idempotent migrate must not duplicate ledger rows"
  fi

  # reset is destructive by design, so exercise it only in this test's unique
  # Compose namespace and confirm it rebuilds the portable schema from scratch.
  if ! run_local_db reset; then
    fail "db-local reset must recreate only its local database and rerun migrations"
  fi
  if [[ -n "$ledger_table" ]]; then
    applied_count_after_reset="$(compose_psql "select count(*) from ${ledger_table}" 2>/dev/null || true)"
    assert_eq "$applied_count_after_reset" "$expected_migrations" \
      "reset must restore the complete portable migration ledger"
  fi
else
  printf 'SKIP: Docker daemon is unavailable; fresh-startup/schema/idempotence checks skipped.\n'
fi

if (( FAILURES > 0 )); then
  printf '\n%d db-local contract assertion(s) failed.\n' "$FAILURES" >&2
  exit 1
fi

printf 'All db-local contract tests passed.\n'
