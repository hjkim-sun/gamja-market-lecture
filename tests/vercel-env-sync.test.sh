#!/usr/bin/env bash
# Dependency-free contract tests for scripts/pull-vercel-env.sh.
# Run: bash tests/vercel-env-sync.test.sh

set -u -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_SOURCE="$ROOT_DIR/scripts/pull-vercel-env.sh"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/gamja-vercel-env-sync.XXXXXX")"
PROJECT_DIR="$TEST_TMP/project"
PROJECT_ROOT=''
FAKE_BIN="$TEST_TMP/bin"
STATE_DIR="$TEST_TMP/state"
FAILURES=0
SECRET_VALUE='super-secret-value-that-must-never-reach-console'

cleanup() {
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

assert_eq() {
  local actual="$1" expected="$2" description="$3"
  [[ "$actual" == "$expected" ]] || fail "$description (expected '$expected', got '$actual')"
}

assert_contains() {
  local needle="$1" file="$2" description="$3"
  grep -F -- "$needle" "$file" >/dev/null 2>&1 || fail "$description (missing '$needle')"
}

assert_not_contains() {
  local needle="$1" file="$2" description="$3"
  if grep -F -- "$needle" "$file" >/dev/null 2>&1; then
    fail "$description (unexpected '$needle')"
  fi
}

assert_matches() {
  local pattern="$1" file="$2" description="$3"
  grep -E -- "$pattern" "$file" >/dev/null 2>&1 || fail "$description (no match for '$pattern')"
}

setup_project() {
  rm -rf "$PROJECT_DIR" "$STATE_DIR"
  mkdir -p "$PROJECT_DIR/scripts" "$PROJECT_DIR/backend" "$PROJECT_DIR/frontend" \
    "$FAKE_BIN" "$STATE_DIR"
  PROJECT_ROOT="$(cd "$PROJECT_DIR" && pwd)"
  cp "$SCRIPT_SOURCE" "$PROJECT_DIR/scripts/pull-vercel-env.sh"
  chmod +x "$PROJECT_DIR/scripts/pull-vercel-env.sh"
}

write_fake_vercel() {
  mkdir -p "$FAKE_BIN"
  cat > "$FAKE_BIN/vercel" <<'EOF'
#!/usr/bin/env bash
set -eu

printf '%s\n' "$*" >> "${VERCEL_TEST_CALLS:?}"

if [[ "$1" != 'env' || "$2" != 'pull' ]]; then
  printf 'fake vercel expected env pull\n' >&2
  exit 64
fi

target=''
environment=''
shift 2
while (( $# > 0 )); do
  case "$1" in
    --environment)
      environment="${2:?missing value for --environment}"
      shift 2
      ;;
    --environment=*)
      environment="${1#--environment=}"
      shift
      ;;
    -e)
      environment="${2:?missing value for -e}"
      shift 2
      ;;
    -e=*)
      environment="${1#-e=}"
      shift
      ;;
    --*)
      shift
      ;;
    *)
      if [[ -z "$target" ]]; then
        target="$1"
      fi
      shift
      ;;
  esac
done

[[ -n "$target" ]] || {
  printf 'fake vercel expected an env-file target\n' >&2
  exit 64
}
[[ -n "$environment" ]] || {
  printf 'fake vercel expected an explicit environment\n' >&2
  exit 64
}

printf 'SYNCED_ENV=%s\n' "$environment" > "$target"
printf 'PULLED_SECRET=%s\n' "${VERCEL_TEST_SECRET:?}" >> "$target"
EOF
  chmod +x "$FAKE_BIN/vercel"
}

run_sync() {
  local caller_dir="$1"
  shift
  (
    cd "$caller_dir"
    PATH="$FAKE_BIN:$PATH" \
      VERCEL_TEST_CALLS="$STATE_DIR/vercel-calls.log" \
      VERCEL_TEST_SECRET="$SECRET_VALUE" \
      "$PROJECT_DIR/scripts/pull-vercel-env.sh" "$@"
  ) > "$STATE_DIR/output.log" 2>&1
}

assert_sync_result() {
  local environment="$1"
  local backend_env="$PROJECT_DIR/backend/.env"
  local frontend_env="$PROJECT_DIR/frontend/.env.local"

  assert_file "$backend_env"
  assert_file "$frontend_env"
  assert_contains "SYNCED_ENV=$environment" "$backend_env" \
    "backend environment file must be pulled for $environment"
  assert_contains "SYNCED_ENV=$environment" "$frontend_env" \
    "frontend environment file must be pulled for $environment"
  assert_contains "env pull $PROJECT_ROOT/backend/.env" "$STATE_DIR/vercel-calls.log" \
    "Vercel must pull directly into backend/.env"
  assert_contains "env pull $PROJECT_ROOT/frontend/.env.local" "$STATE_DIR/vercel-calls.log" \
    "Vercel must pull directly into frontend/.env.local"
  assert_matches "(^| )(\\-\\-environment(=| )|\\-e(=| ))$environment( |$)" \
    "$STATE_DIR/vercel-calls.log" \
    "Vercel pulls must specify the selected environment explicitly"
  assert_not_contains "$SECRET_VALUE" "$STATE_DIR/output.log" \
    "sync command output must never expose pulled secret values"
}

if [[ ! -f "$SCRIPT_SOURCE" ]]; then
  fail "missing required environment sync script: scripts/pull-vercel-env.sh"
else
  write_fake_vercel

  # Default invocation must pull development values into both services, even
  # when launched from a directory unrelated to the repository root.
  setup_project
  : > "$STATE_DIR/vercel-calls.log"
  if ! run_sync "$TEST_TMP"; then
    fail "default environment sync must succeed from outside the repository root"
  fi
  assert_sync_result 'development'

  # A caller can intentionally select another Vercel environment.
  setup_project
  : > "$STATE_DIR/vercel-calls.log"
  if ! run_sync "$PROJECT_DIR/frontend" --environment preview; then
    fail "environment sync must accept --environment preview"
  fi
  assert_sync_result 'preview'

  # The error must tell developers exactly which missing dependency to install.
  setup_project
  if (
    cd "$PROJECT_DIR/backend"
    PATH='/usr/bin:/bin' "$PROJECT_DIR/scripts/pull-vercel-env.sh"
  ) > "$STATE_DIR/no-vercel.out" 2>&1; then
    fail "environment sync must fail when the Vercel CLI is unavailable"
  fi
  assert_contains 'Vercel CLI' "$STATE_DIR/no-vercel.out" \
    "missing Vercel CLI error must clearly identify the dependency"
fi

if (( FAILURES > 0 )); then
  printf '\n%d test assertion(s) failed.\n' "$FAILURES" >&2
  exit 1
fi

printf 'All Vercel environment-sync contract tests passed.\n'
