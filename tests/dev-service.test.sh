#!/usr/bin/env bash
# Dependency-free contract tests for scripts/dev.sh.
# Run: bash tests/dev-service.test.sh

set -u -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_SCRIPT="$ROOT_DIR/scripts/dev.sh"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/gamja-dev-service.XXXXXX")"
FAKE_BIN="$TEST_TMP/bin"
STATE_DIR="$TEST_TMP/state"
LOG_DIR="$TEST_TMP/logs"
FAILURES=0
TRACKED_PIDS=()

mkdir -p "$FAKE_BIN" "$STATE_DIR" "$LOG_DIR"

cleanup() {
  local pid

  for pid in "${TRACKED_PIDS[@]:-}"; do
    [[ -n "$pid" ]] || continue
    kill "$pid" 2>/dev/null || true
  done
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

assert_not_file() {
  [[ ! -e "$1" ]] || fail "expected file to be absent: $1"
}

assert_eq() {
  local actual="$1" expected="$2" description="$3"
  [[ "$actual" == "$expected" ]] || fail "$description (expected '$expected', got '$actual')"
}

assert_contains() {
  local needle="$1" file="$2" description="$3"
  grep -F -- "$needle" "$file" >/dev/null 2>&1 || fail "$description (missing '$needle')"
}

wait_for_contains() {
  local needle="$1" file="$2" description="$3" _attempt

  for _attempt in {1..20}; do
    if [[ -f "$file" ]] && grep -F -- "$needle" "$file" >/dev/null 2>&1; then
      return
    fi
    sleep 0.05
  done
  fail "$description (missing '$needle' after 1 second)"
}

wait_for_line_count() {
  local file="$1" expected="$2" description="$3" _attempt actual

  for _attempt in {1..20}; do
    if [[ -f "$file" ]]; then
      actual="$(wc -l < "$file" | tr -d ' ')"
      [[ "$actual" == "$expected" ]] && return
    fi
    sleep 0.05
  done
  actual=0
  [[ -f "$file" ]] && actual="$(wc -l < "$file" | tr -d ' ')"
  fail "$description (expected '$expected' lines after 1 second, got '$actual')"
}

assert_pid_running() {
  local pid="$1" description="$2"
  kill -0 "$pid" 2>/dev/null || fail "$description (PID $pid is not running)"
}

assert_pid_stopped() {
  local pid="$1" description="$2" _attempt

  for _attempt in {1..20}; do
    kill -0 "$pid" 2>/dev/null || return
    sleep 0.05
  done
  fail "$description (PID $pid is still running)"
  kill "$pid" 2>/dev/null || true
}

track_pid() {
  TRACKED_PIDS+=("$1")
}

write_fake_commands() {
  write_fake_service_command() {
    local command_name="$1"
    printf '%s\n' \
      '#!/usr/bin/env bash' \
      'set -eu' \
      "printf '%s|$command_name %s|DATABASE_URL=%s\\n' \"\$PWD\" \"\$*\" \"\${DATABASE_URL-}\" >> \"\${DEV_TEST_LOG_DIR}/commands.log\"" \
      'exec sleep 600' > "$FAKE_BIN/$command_name"
    chmod +x "$FAKE_BIN/$command_name"
  }

  write_fake_service_command uv
  write_fake_service_command npm

  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'if [[ "${DEV_TEST_PORT_CONFLICT:-0}" == "1" ]]; then' \
    "  printf 'mock process holds requested port\\n'" \
    '  exit 0' \
    'fi' \
    'exit 1' > "$FAKE_BIN/lsof"
  chmod +x "$FAKE_BIN/lsof"
}

run_dev() {
  PATH="$FAKE_BIN:$PATH" \
    DEV_STATE_DIR="$STATE_DIR" \
    DEV_TEST_LOG_DIR="$LOG_DIR" \
    "$DEV_SCRIPT" "$@" >"$LOG_DIR/last-command.out" 2>&1
}

run_dev_with_conflict() {
  PATH="$FAKE_BIN:$PATH" \
    DEV_STATE_DIR="$STATE_DIR" \
    DEV_TEST_LOG_DIR="$LOG_DIR" \
    DEV_TEST_PORT_CONFLICT=1 \
    "$DEV_SCRIPT" "$@" >"$LOG_DIR/last-command.out" 2>&1
}

run_dev_with_backend_env_file() {
  env -u DATABASE_URL \
    PATH="$FAKE_BIN:$PATH" \
    DEV_STATE_DIR="$STATE_DIR" \
    DEV_TEST_LOG_DIR="$LOG_DIR" \
    DEV_BACKEND_ENV_FILE="$BACKEND_ENV_FILE" \
    "$DEV_SCRIPT" "$@" >"$LOG_DIR/last-command.out" 2>&1
}

if [[ ! -f "$DEV_SCRIPT" ]]; then
  fail "missing required service controller: scripts/dev.sh"
  printf '\n%d test assertion(s) failed.\n' "$FAILURES" >&2
  exit 1
fi

if [[ ! -x "$DEV_SCRIPT" ]]; then
  fail "scripts/dev.sh must be executable"
fi

write_fake_commands

# A backend start runs the documented Uvicorn command from backend/, writes its PID,
# and leaves that tracked PID alive for a later stop/restart action.
rm -f "$LOG_DIR/commands.log"
if ! run_dev backend start; then
  fail "backend start must succeed when port 8000 is free"
fi
BACKEND_PID_FILE="$STATE_DIR/backend.pid"
assert_file "$BACKEND_PID_FILE"
BACKEND_PID="$(<"$BACKEND_PID_FILE")"
track_pid "$BACKEND_PID"
assert_pid_running "$BACKEND_PID" "backend start must track a running service PID"
wait_for_contains "$ROOT_DIR/backend|uv run uvicorn app.main:app --reload" "$LOG_DIR/commands.log" \
  "backend start must invoke Uvicorn through uv from backend/"

# Stop is idempotent: it terminates the tracked process and clears its state; a second
# stop has the same successful, no-process result.
if ! run_dev backend stop; then
  fail "backend stop must succeed for a tracked service"
fi
assert_pid_stopped "$BACKEND_PID" "backend stop must terminate its tracked PID"
assert_not_file "$BACKEND_PID_FILE"
if ! run_dev backend stop; then
  fail "backend stop must be idempotent when no PID file exists"
fi
assert_not_file "$BACKEND_PID_FILE"

# Backend startup must load its ignored .env configuration before uv executes.
# The override keeps this fixture outside the shared worktree while preserving
# the production default of backend/.env.
BACKEND_ENV_FILE="$TEST_TMP/backend/.env"
EXPECTED_DATABASE_URL='postgresql://contract_user:contract_password@localhost:5432/contract_db'
mkdir -p "${BACKEND_ENV_FILE%/*}"
printf 'DATABASE_URL=%s\n' "$EXPECTED_DATABASE_URL" > "$BACKEND_ENV_FILE"
rm -f "$LOG_DIR/commands.log"
if ! run_dev_with_backend_env_file backend start; then
  fail "backend start must succeed when its configured environment file exists"
fi
ENV_BACKEND_PID="$(<"$BACKEND_PID_FILE")"
track_pid "$ENV_BACKEND_PID"
assert_pid_running "$ENV_BACKEND_PID" "backend environment-file start must track a running service PID"
wait_for_contains \
  "$ROOT_DIR/backend|uv run uvicorn app.main:app --reload|DATABASE_URL=$EXPECTED_DATABASE_URL" \
  "$LOG_DIR/commands.log" \
  "backend start must load DATABASE_URL from its environment file before launching uv"
if ! run_dev backend stop; then
  fail "backend stop must succeed after an environment-file start"
fi
assert_pid_stopped "$ENV_BACKEND_PID" "backend stop must terminate the environment-file service"
assert_not_file "$BACKEND_PID_FILE"

# Stale state is also harmless: a non-existent PID must be cleared without failure.
printf '999999\n' > "$BACKEND_PID_FILE"
if ! run_dev backend stop; then
  fail "backend stop must succeed for a stale PID file"
fi
assert_not_file "$BACKEND_PID_FILE"

# Restart must stop the old service before replacing its PID with a newly started service.
rm -f "$LOG_DIR/commands.log"
if ! run_dev backend start; then
  fail "backend start before restart must succeed"
fi
OLD_BACKEND_PID="$(<"$BACKEND_PID_FILE")"
if ! run_dev backend restart; then
  fail "backend restart must succeed"
fi
NEW_BACKEND_PID="$(<"$BACKEND_PID_FILE")"
track_pid "$NEW_BACKEND_PID"
assert_pid_stopped "$OLD_BACKEND_PID" "backend restart must stop the prior tracked PID"
assert_pid_running "$NEW_BACKEND_PID" "backend restart must track the replacement PID"
[[ "$OLD_BACKEND_PID" != "$NEW_BACKEND_PID" ]] || fail "backend restart must replace the tracked PID"
wait_for_line_count "$LOG_DIR/commands.log" "2" \
  "backend restart must launch exactly one additional backend process"
assert_eq "$(wc -l < "$LOG_DIR/commands.log" | tr -d ' ')" "2" \
  "backend restart must launch exactly one additional backend process"

# Frontend follows the same contract, but starts Next.js through npm from frontend/.
rm -f "$LOG_DIR/commands.log"
if ! run_dev frontend start; then
  fail "frontend start must succeed when port 3000 is free"
fi
FRONTEND_PID_FILE="$STATE_DIR/frontend.pid"
assert_file "$FRONTEND_PID_FILE"
FRONTEND_PID="$(<"$FRONTEND_PID_FILE")"
track_pid "$FRONTEND_PID"
assert_pid_running "$FRONTEND_PID" "frontend start must track a running service PID"
wait_for_contains "$ROOT_DIR/frontend|npm run dev" "$LOG_DIR/commands.log" \
  "frontend start must invoke npm run dev from frontend/"
if ! run_dev frontend restart; then
  fail "frontend restart must succeed"
fi
RESTARTED_FRONTEND_PID="$(<"$FRONTEND_PID_FILE")"
track_pid "$RESTARTED_FRONTEND_PID"
assert_pid_stopped "$FRONTEND_PID" "frontend restart must stop the prior tracked PID"
assert_pid_running "$RESTARTED_FRONTEND_PID" "frontend restart must track the replacement PID"
if ! run_dev frontend stop || ! run_dev frontend stop; then
  fail "frontend stop must be idempotent"
fi
assert_not_file "$FRONTEND_PID_FILE"

# A detected port conflict must fail before launch and must not create/overwrite PID state.
rm -f "$LOG_DIR/commands.log" "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE"
if run_dev_with_conflict backend start; then
  fail "backend start must fail when its port is already occupied"
fi
assert_not_file "$BACKEND_PID_FILE"
[[ ! -f "$LOG_DIR/commands.log" ]] || fail "backend port conflict must not launch uv"
if run_dev_with_conflict frontend start; then
  fail "frontend start must fail when its port is already occupied"
fi
assert_not_file "$FRONTEND_PID_FILE"
[[ ! -f "$LOG_DIR/commands.log" ]] || fail "frontend port conflict must not launch npm"

# The convenience all target starts and stops both independently tracked services.
if ! run_dev all start; then
  fail "all start must succeed when both ports are free"
fi
assert_file "$BACKEND_PID_FILE"
assert_file "$FRONTEND_PID_FILE"
track_pid "$(<"$BACKEND_PID_FILE")"
track_pid "$(<"$FRONTEND_PID_FILE")"
if ! run_dev all stop; then
  fail "all stop must stop both services"
fi
assert_not_file "$BACKEND_PID_FILE"
assert_not_file "$FRONTEND_PID_FILE"

if (( FAILURES > 0 )); then
  printf '\n%d test assertion(s) failed.\n' "$FAILURES" >&2
  exit 1
fi

printf 'All dev-service contract tests passed.\n'
