#!/usr/bin/env bash
# Dependency-free contract tests for scripts/pull-env.sh.
# Run: bash tests/vercel-env-sync.test.sh

set -u -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_SOURCE="$ROOT_DIR/scripts/pull-env.sh"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/gamja-vercel-env-sync.XXXXXX")"
PROJECT_DIR="$TEST_TMP/project"
WORKTREE_DIR="$TEST_TMP/worktree"
FAKE_BIN="$TEST_TMP/bin"
STATE_DIR="$TEST_TMP/state"
FAILURES=0

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

assert_files_equal() {
  local expected="$1" actual="$2" description="$3"
  cmp -s "$expected" "$actual" || fail "$description"
}

assert_empty_file() {
  local file="$1" description="$2"
  [[ ! -s "$file" ]] || fail "$description"
}

setup_project() {
  rm -rf "$PROJECT_DIR" "$WORKTREE_DIR" "$STATE_DIR"
  mkdir -p "$PROJECT_DIR/scripts" "$PROJECT_DIR/backend" "$PROJECT_DIR/frontend" \
    "$FAKE_BIN" "$STATE_DIR"
  cp "$SCRIPT_SOURCE" "$PROJECT_DIR/scripts/pull-env.sh"
  chmod +x "$PROJECT_DIR/scripts/pull-env.sh"
}

setup_git_worktree_project() {
  setup_project

  git -C "$PROJECT_DIR" init -q
  git -C "$PROJECT_DIR" config user.email 'test@example.com'
  git -C "$PROJECT_DIR" config user.name 'Environment Sync Test'
  : > "$PROJECT_DIR/backend/.gitkeep"
  : > "$PROJECT_DIR/frontend/.gitkeep"
  git -C "$PROJECT_DIR" add scripts/pull-env.sh backend/.gitkeep frontend/.gitkeep
  git -C "$PROJECT_DIR" commit -qm 'test fixture'
  git -C "$PROJECT_DIR" worktree add -q -b env-copy-contract "$WORKTREE_DIR"
}

write_fake_vercel() {
  mkdir -p "$FAKE_BIN"
  cat > "$FAKE_BIN/vercel" <<'EOF'
#!/usr/bin/env bash
set -eu

printf '%s\n' "$*" >> "${VERCEL_TEST_CALLS:?}"
printf 'Vercel must not be called by worktree environment sync\n' >&2
exit 97
EOF
  chmod +x "$FAKE_BIN/vercel"
}

run_sync() {
  local script_path="$1" caller_dir="$2"
  (
    cd "$caller_dir"
    PATH="$FAKE_BIN:$PATH" \
      VERCEL_TEST_CALLS="$STATE_DIR/vercel-calls.log" \
      "$script_path"
  ) > "$STATE_DIR/output.log" 2>&1
}

if [[ ! -f "$SCRIPT_SOURCE" ]]; then
  fail "missing required environment sync script: scripts/pull-env.sh"
else
  write_fake_vercel

  # The script is only meaningful in a linked Git worktree. A regular
  # directory cannot identify a primary checkout from which to copy values.
  setup_project
  : > "$STATE_DIR/vercel-calls.log"
  if run_sync "$PROJECT_DIR/scripts/pull-env.sh" "$PROJECT_DIR/backend"; then
    fail "environment sync must require Git worktree metadata"
  fi
  assert_empty_file "$STATE_DIR/vercel-calls.log" \
    "metadata failure must not invoke Vercel CLI"

  # A worktree receives both locally synced files from the primary checkout.
  setup_git_worktree_project
  printf 'BACKEND_ORIGIN=primary\nTOKEN=backend-primary\n' > "$PROJECT_DIR/backend/.env"
  printf 'FRONTEND_ORIGIN=primary\nTOKEN=frontend-primary\n' > "$PROJECT_DIR/frontend/.env.local"
  printf 'BACKEND_ORIGIN=stale\n' > "$WORKTREE_DIR/backend/.env"
  printf 'FRONTEND_ORIGIN=stale\n' > "$WORKTREE_DIR/frontend/.env.local"
  : > "$STATE_DIR/vercel-calls.log"
  if ! run_sync "$WORKTREE_DIR/scripts/pull-env.sh" "$WORKTREE_DIR/frontend"; then
    fail "worktree environment sync must succeed without Vercel CLI access"
  fi
  assert_file "$WORKTREE_DIR/backend/.env"
  assert_file "$WORKTREE_DIR/frontend/.env.local"
  assert_files_equal "$PROJECT_DIR/backend/.env" "$WORKTREE_DIR/backend/.env" \
    "worktree backend environment must match the primary checkout"
  assert_files_equal "$PROJECT_DIR/frontend/.env.local" "$WORKTREE_DIR/frontend/.env.local" \
    "worktree frontend environment must match the primary checkout"
  assert_empty_file "$STATE_DIR/vercel-calls.log" \
    "worktree sync must not invoke Vercel CLI"

  # Missing either primary source must leave every existing target unchanged:
  # a partial update would break the atomic two-file synchronization contract.
  setup_git_worktree_project
  printf 'BACKEND_ORIGIN=primary\n' > "$PROJECT_DIR/backend/.env"
  printf 'BACKEND_ORIGIN=before-sync\n' > "$WORKTREE_DIR/backend/.env"
  printf 'FRONTEND_ORIGIN=before-sync\n' > "$WORKTREE_DIR/frontend/.env.local"
  cp "$WORKTREE_DIR/backend/.env" "$STATE_DIR/backend-before.env"
  cp "$WORKTREE_DIR/frontend/.env.local" "$STATE_DIR/frontend-before.env.local"
  : > "$STATE_DIR/vercel-calls.log"
  if run_sync "$WORKTREE_DIR/scripts/pull-env.sh" "$WORKTREE_DIR"; then
    fail "worktree environment sync must fail when a primary source is missing"
  fi
  assert_files_equal "$STATE_DIR/backend-before.env" "$WORKTREE_DIR/backend/.env" \
    "missing frontend source must preserve the backend target"
  assert_files_equal "$STATE_DIR/frontend-before.env.local" "$WORKTREE_DIR/frontend/.env.local" \
    "missing frontend source must preserve the frontend target"
  assert_empty_file "$STATE_DIR/vercel-calls.log" \
    "missing-source failure must not invoke Vercel CLI"
fi

if (( FAILURES > 0 )); then
  printf '\n%d test assertion(s) failed.\n' "$FAILURES" >&2
  exit 1
fi

printf 'All worktree environment-sync contract tests passed.\n'
