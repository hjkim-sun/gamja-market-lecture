#!/usr/bin/env bash
# Manage the portable subset of Supabase migrations on local Docker Postgres.
# This script deliberately does not read backend/.env or DATABASE_URL.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.local.yml"
MIGRATIONS_DIR="$ROOT_DIR/backend/supabase/migrations"
EXCLUSIONS_FILE="$MIGRATIONS_DIR/local-migration-exclusions.tsv"
SERVICE_NAME="postgres"
DATABASE_NAME="gamja_market"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-gamja_market_local}"

usage() {
  printf '%s\n' 'Usage: scripts/db-local.sh <up|down|reset|migrate|status>' >&2
}

die() {
  printf 'db-local: %s\n' "$*" >&2
  exit 1
}

compose() {
  docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die 'Docker CLI is required.'
  docker info >/dev/null 2>&1 || die 'a running Docker daemon is required.'
}

is_known_supabase_specific() {
  local migration_file="$1"
  # Existing migrations document auth/storage in comments; comments are not a
  # database dependency and must not make an otherwise portable SQL file fail.
  sed -E 's/--.*$//' "$migration_file" | grep -Eiq \
    '(^|[^[:alnum:]_])(auth|storage|vault|extensions)[[:space:]]*\.|auth[[:space:]]*\.[[:alnum:]_]+|auth[[:space:]]*\.(uid|jwt)[[:space:]]*\(|supabase_[[:alnum:]_]+[[:space:]]*\(' \
    -
}

is_excluded() {
  local filename="$1"
  awk -F '\t' -v target="$filename" \
    '$0 !~ /^[[:space:]]*#/ && NF >= 2 && $1 == target { found = 1 } END { exit(found ? 0 : 1) }' \
    "$EXCLUSIONS_FILE"
}

validate_exclusion_manifest() {
  [[ -f "$EXCLUSIONS_FILE" ]] || die "missing exclusion manifest: $EXCLUSIONS_FILE"

  if awk -F '\t' '
    $0 !~ /^[[:space:]]*#/ && NF > 0 {
      if (NF != 2 || $1 == "" || $2 == "") invalid = 1
      if (++count[$1] > 1) duplicate = 1
    }
    END { exit(invalid || duplicate) }
  ' "$EXCLUSIONS_FILE"; then
    :
  else
    die 'the local migration exclusion manifest must contain unique filename/reason pairs.'
  fi

  local filename reason ignored
  while IFS=$'\t' read -r filename reason ignored; do
    [[ -z "$filename" || "$filename" == \#* ]] && continue
    [[ -z "${ignored:-}" ]] || die "invalid exclusion manifest entry for $filename"
    [[ -f "$MIGRATIONS_DIR/$filename" ]] || die "exclusion manifest references missing migration: $filename"
    is_known_supabase_specific "$MIGRATIONS_DIR/$filename" || \
      die "exclusion manifest entry is not a recognized Supabase-specific migration: $filename"
  done < "$EXCLUSIONS_FILE"
}

validate_migrations() {
  [[ -d "$MIGRATIONS_DIR" ]] || die "migration directory is missing: $MIGRATIONS_DIR"
  validate_exclusion_manifest

  local migration_file filename
  while IFS= read -r migration_file; do
    filename="${migration_file##*/}"
    if is_excluded "$filename"; then
      continue
    fi
    if is_known_supabase_specific "$migration_file"; then
      die "Supabase-specific migration is not intentionally excluded: $filename"
    fi
  done < <(LC_ALL=C find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -print | LC_ALL=C sort)
}

wait_for_database() {
  local attempt
  for attempt in $(seq 1 30); do
    if compose exec -T "$SERVICE_NAME" pg_isready -U postgres -d "$DATABASE_NAME" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die 'local PostgreSQL did not become ready within 30 seconds.'
}

create_role_stubs() {
  compose exec -T "$SERVICE_NAME" psql -v ON_ERROR_STOP=1 -U postgres -d "$DATABASE_NAME" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;
SQL
}

initialize_ledger() {
  compose exec -T "$SERVICE_NAME" psql -v ON_ERROR_STOP=1 -U postgres -d "$DATABASE_NAME" <<'SQL'
CREATE SCHEMA IF NOT EXISTS local_dev;
CREATE TABLE IF NOT EXISTS local_dev.applied_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
SQL
}

migration_is_applied() {
  local filename="$1"
  local result
  local filename_literal
  filename_literal="$(sql_literal "$filename")"
  # Do not let docker compose inherit the migration loop's stdin; psql's
  # command mode otherwise consumes the remaining filenames on some runtimes.
  result="$(compose exec -T "$SERVICE_NAME" psql -v ON_ERROR_STOP=1 -U postgres -d "$DATABASE_NAME" -Atqc "select exists (select 1 from local_dev.applied_migrations where filename = $filename_literal);" </dev/null)"
  [[ "$result" == 't' ]]
}

sql_literal() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

apply_migration() {
  local migration_file="$1"
  local filename="${migration_file##*/}"
  local filename_literal
  filename_literal="$(sql_literal "$filename")"

  printf 'Applying migration: %s\n' "$filename"
  {
    printf '%s\n' 'BEGIN;'
    sed -n '1,$p' "$migration_file"
    printf '\nINSERT INTO local_dev.applied_migrations (filename) VALUES (%s);\nCOMMIT;\n' "$filename_literal"
  } | compose exec -T "$SERVICE_NAME" psql -v ON_ERROR_STOP=1 -U postgres -d "$DATABASE_NAME"
}

migrate() {
  validate_migrations
  require_docker
  wait_for_database
  create_role_stubs
  initialize_ledger

  local migration_file filename
  while IFS= read -r migration_file; do
    filename="${migration_file##*/}"
    if is_excluded "$filename"; then
      continue
    fi
    if migration_is_applied "$filename"; then
      continue
    fi
    apply_migration "$migration_file"
  done < <(LC_ALL=C find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -print | LC_ALL=C sort)

  printf '%s\n' 'Local portable migrations are up to date.'
}

up() {
  validate_migrations
  require_docker
  compose up -d
  migrate
}

down() {
  require_docker
  compose down --remove-orphans
}

reset() {
  validate_migrations
  require_docker
  # --project-name and -f constrain deletion to this controller's Compose scope.
  compose down --volumes --remove-orphans
  compose up -d
  migrate
}

status() {
  require_docker
  compose ps
  if compose exec -T "$SERVICE_NAME" pg_isready -U postgres -d "$DATABASE_NAME" >/dev/null 2>&1; then
    printf '%s\n' 'Applied portable migrations:'
    compose exec -T "$SERVICE_NAME" psql -U postgres -d "$DATABASE_NAME" -At \
      -c 'select filename from local_dev.applied_migrations order by filename;' 2>/dev/null || true
  else
    printf '%s\n' 'Local PostgreSQL is not running.'
  fi
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  reset) reset ;;
  migrate) migrate ;;
  status) status ;;
  *)
    usage
    die "unknown command: ${1:-<none>}"
    ;;
esac
