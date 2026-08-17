#!/usr/bin/env bash
# Pull a linked Vercel project's environment variables for local development.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVIRONMENT='development'
TARGETS=(
  "$ROOT_DIR/backend/.env"
  "$ROOT_DIR/frontend/.env.local"
)
BACKUPS=()
EXISTED=()

usage() {
  cat <<'EOF'
Usage: pull-vercel-env.sh [--environment <development|preview|production>]

Pull variables from the linked Vercel project into backend/.env and
frontend/.env.local. The default environment is development.

Options:
  -e, --environment ENV     Vercel environment to pull
  -h, --help                Show this help
EOF
}

fail_usage() {
  printf 'Error: %s\n\n' "$1" >&2
  usage >&2
  exit 64
}

parse_args() {
  while (( $# > 0 )); do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      -e|--environment)
        (( $# >= 2 )) || fail_usage "missing value for $1"
        ENVIRONMENT="$2"
        shift 2
        ;;
      -e=*|--environment=*)
        ENVIRONMENT="${1#*=}"
        shift
        ;;
      *)
        fail_usage "unknown argument: $1"
        ;;
    esac
  done

  case "$ENVIRONMENT" in
    development|preview|production) ;;
    '') fail_usage 'environment must not be empty' ;;
    *) fail_usage "invalid environment: $ENVIRONMENT (expected development, preview, or production)" ;;
  esac
}

require_vercel() {
  if ! command -v vercel >/dev/null 2>&1; then
    printf 'Vercel CLI is required. Install it with: npm install --global vercel\n' >&2
    exit 127
  fi
}

prepare_backups() {
  local target backup
  for target in "${TARGETS[@]}"; do
    if [[ -e "$target" ]]; then
      backup="$(mktemp "${target}.backup.XXXXXX")"
      cp -p "$target" "$backup"
      BACKUPS+=("$backup")
      EXISTED+=(1)
    else
      BACKUPS+=('')
      EXISTED+=(0)
    fi
  done
}

discard_backups() {
  local backup
  for backup in "${BACKUPS[@]}"; do
    [[ -z "$backup" ]] || rm -f "$backup"
  done
}

restore_targets() {
  local index target backup
  for index in "${!TARGETS[@]}"; do
    target="${TARGETS[$index]}"
    backup="${BACKUPS[$index]}"
    if [[ "${EXISTED[$index]}" == 1 ]]; then
      mv -f "$backup" "$target"
    else
      rm -f "$target"
    fi
  done
}

pull_target() {
  local target="$1"

  # Keep the CLI's output out of the terminal: it must never reveal local
  # environment-file contents or credentials.
  vercel env pull "$target" --environment "$ENVIRONMENT" --yes >/dev/null 2>&1
}

main() {
  parse_args "$@"
  require_vercel

  # Vercel resolves the existing .vercel link from the repository root, not
  # from the caller's current directory.
  cd "$ROOT_DIR"
  prepare_backups

  local target
  for target in "${TARGETS[@]}"; do
    if ! pull_target "$target"; then
      restore_targets
      printf 'Failed to pull Vercel %s environment variables; existing files were preserved.\n' \
        "$ENVIRONMENT" >&2
      return 1
    fi
  done

  discard_backups
  printf 'Pulled Vercel %s environment variables into backend/.env and frontend/.env.local.\n' \
    "$ENVIRONMENT"
}

main "$@"
