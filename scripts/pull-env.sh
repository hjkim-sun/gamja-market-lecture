#!/usr/bin/env bash
# Copy already-synced environment files from this repository's primary checkout.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS=(
  "$ROOT_DIR/backend/.env"
  "$ROOT_DIR/frontend/.env.local"
)
SOURCES=()
TEMP_FILES=()

usage() {
  cat <<'EOF'
Usage: pull-vercel-env.sh

Copy backend/.env and frontend/.env.local from the primary Git checkout into
the current checkout. The primary checkout must already contain both files.
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
      *)
        fail_usage "unknown argument: $1"
        ;;
    esac
  done
}

cleanup_temps() {
  local temp
  for temp in "${TEMP_FILES[@]}"; do
    [[ -z "$temp" ]] || rm -f "$temp"
  done
}

find_primary_checkout() {
  local line primary=''

  if ! git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf 'Unable to locate the primary Git checkout: this script must run from a Git worktree.\n' >&2
    return 1
  fi

  # `git worktree list --porcelain` lists the repository's primary checkout
  # first. It also scopes the result to the current checkout's shared Git dir.
  while IFS= read -r line; do
    case "$line" in
      'worktree '*)
        primary="${line#worktree }"
        break
        ;;
    esac
  done < <(git -C "$ROOT_DIR" worktree list --porcelain 2>/dev/null)

  if [[ -z "$primary" || ! -d "$primary" ]]; then
    printf 'Unable to locate the primary Git checkout; target environment files were preserved.\n' >&2
    return 1
  fi

  SOURCES=(
    "$primary/backend/.env"
    "$primary/frontend/.env.local"
  )
}

validate_sources() {
  local index source target
  for index in "${!SOURCES[@]}"; do
    source="${SOURCES[$index]}"
    target="${TARGETS[$index]}"

    if [[ ! -f "$source" || ! -r "$source" ]]; then
      printf 'Primary checkout environment source is unavailable for %s; target files were preserved.\n' \
        "$(basename "$target")" >&2
      return 1
    fi
    if [[ ! -d "$(dirname "$target")" ]]; then
      printf 'Target directory is unavailable for %s; target files were preserved.\n' \
        "$(basename "$target")" >&2
      return 1
    fi
  done
}

stage_copies() {
  local index source target temp
  for index in "${!SOURCES[@]}"; do
    source="${SOURCES[$index]}"
    target="${TARGETS[$index]}"
    temp="$(mktemp "${target}.tmp.XXXXXX")"
    TEMP_FILES+=("$temp")

    if ! cp -p "$source" "$temp"; then
      printf 'Failed to stage environment files from the primary checkout; target files were preserved.\n' >&2
      return 1
    fi
  done
}

commit_copies() {
  local index temp target
  for index in "${!TARGETS[@]}"; do
    temp="${TEMP_FILES[$index]}"
    target="${TARGETS[$index]}"
    if ! mv -f "$temp" "$target"; then
      printf 'Failed to replace %s with the staged environment file.\n' "$(basename "$target")" >&2
      return 1
    fi
    TEMP_FILES[$index]=''
  done
}

main() {
  parse_args "$@"
  find_primary_checkout
  validate_sources
  stage_copies
  commit_copies
  printf 'Copied environment files from the primary Git checkout.\n'
}

trap cleanup_temps EXIT
main "$@"
