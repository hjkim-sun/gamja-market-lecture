#!/usr/bin/env bash
# Manage the local frontend and backend development servers.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${DEV_STATE_DIR:-}" ]]; then
  STATE_DIR="$DEV_STATE_DIR"
else
  GIT_COMMON_DIR="$(git -C "$ROOT_DIR" rev-parse --path-format=absolute --git-common-dir)"
  REPOSITORY_ROOT="$(dirname "$GIT_COMMON_DIR")"
  STATE_DIR="$REPOSITORY_ROOT/.runtime/dev"
fi
LOG_DIR="$STATE_DIR/logs"

usage() {
  printf 'Usage: %s <backend|frontend|all> <start|stop|restart>\n' "${0##*/}" >&2
}

service_port() {
  case "$1" in
    backend) printf '8000\n' ;;
    frontend) printf '3000\n' ;;
  esac
}

pid_file() {
  printf '%s/%s.pid\n' "$STATE_DIR" "$1"
}

is_running() {
  local pid="$1"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null
}

is_own_process_group_leader() {
  local pid="$1" process_group_id

  # Services launched by detach_and_exec() become the leader of a dedicated
  # session and process group.  Only address a negative PID when that remains
  # true: a legacy PID file can point at a process in the caller's group, and
  # killing that group would be unsafe.
  process_group_id="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]')" || return 1
  [[ "$process_group_id" == "$pid" ]]
}

tracked_termination_target() {
  local pid="$1"

  if is_own_process_group_leader "$pid"; then
    # A negative PID targets the service's complete process group, including
    # reloaders and other descendants that can retain the service port.
    printf -- '-%s\n' "$pid"
  else
    # PID files from before session-based startup remain supported, but can
    # only be terminated one process at a time without risking this shell.
    printf '%s\n' "$pid"
  fi
}

read_tracked_pid() {
  local file
  file="$(pid_file "$1")"
  [[ -f "$file" ]] || return 1

  local pid
  IFS= read -r pid < "$file" || true
  if is_running "$pid"; then
    printf '%s\n' "$pid"
    return 0
  fi

  rm -f "$file"
  return 1
}

port_is_in_use() {
  local port="$1"
  command -v lsof >/dev/null 2>&1 || {
    printf 'Cannot check port %s: lsof is required.\n' "$port" >&2
    return 2
  }
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1
}

detach_and_exec() {
  if ! command -v python3 >/dev/null 2>&1; then
    printf 'Cannot detach service: python3 with os.setsid() is required.\n' >&2
    return 127
  fi

  # nohup ignores a terminal hangup before Python creates a new session.  The
  # exec keeps the PID written by the controller attached to the real service.
  exec nohup python3 -c '
import os
import sys

os.setsid()
os.execvp(sys.argv[1], sys.argv[1:])
' "$@"
}

load_backend_env() {
  local env_file="${DEV_BACKEND_ENV_FILE:-$ROOT_DIR/backend/.env}"

  [[ -f "$env_file" ]] || return 0

  # Export declarations in the local development file for the backend process
  # only.  Do not print this file: it can contain credentials.
  set -a
  # shellcheck source=/dev/null
  source "$env_file"
  set +a
}

start_service() {
  local service="$1" port pid_file_path log_file
  port="$(service_port "$service")"
  pid_file_path="$(pid_file "$service")"
  log_file="$LOG_DIR/$service.log"

  local pid
  if pid="$(read_tracked_pid "$service")"; then
    printf '%s is already running (PID %s).\n' "$service" "$pid"
    return 0
  fi

  if port_is_in_use "$port"; then
    printf 'Cannot start %s: port %s is already in use by another process.\n' "$service" "$port" >&2
    return 1
  else
    local port_check_status=$?
    if (( port_check_status != 1 )); then
      return "$port_check_status"
    fi
  fi

  mkdir -p "$STATE_DIR" "$LOG_DIR"
  case "$service" in
    backend)
      (
        cd "$ROOT_DIR/backend"
        load_backend_env
        detach_and_exec uv run uvicorn app.main:app --reload
      ) >>"$log_file" 2>&1 &
      ;;
    frontend)
      (
        cd "$ROOT_DIR/frontend"
        detach_and_exec npm run dev
      ) >>"$log_file" 2>&1 &
      ;;
  esac

  local pid=$!
  printf '%s\n' "$pid" > "$pid_file_path"
  # The detached child has its own session; wait briefly so immediate callers
  # can also observe an exec-time startup failure.
  sleep 0.2
  if ! is_running "$pid"; then
    rm -f "$pid_file_path"
    printf 'Failed to start %s; see %s.\n' "$service" "$log_file" >&2
    return 1
  fi
  printf 'Started %s (PID %s); output: %s\n' "$service" "$pid" "$log_file"
}

stop_service() {
  local service="$1" pid_file_path pid termination_target
  pid_file_path="$(pid_file "$service")"

  if ! pid="$(read_tracked_pid "$service")"; then
    printf '%s is not running.\n' "$service"
    return 0
  fi

  termination_target="$(tracked_termination_target "$pid")"
  kill -TERM -- "$termination_target" 2>/dev/null || true
  local attempt
  for attempt in {1..40}; do
    # For controller-owned sessions, wait for the whole group rather than
    # merely its leader so restart cannot race a child still holding the port.
    if ! kill -0 -- "$termination_target" 2>/dev/null; then
      rm -f "$pid_file_path"
      printf 'Stopped %s (PID %s).\n' "$service" "$pid"
      return 0
    fi
    sleep 0.05
  done

  printf 'Unable to stop %s (PID %s); leaving its PID file in place.\n' "$service" "$pid" >&2
  return 1
}

restart_service() {
  stop_service "$1"
  start_service "$1"
}

run_one() {
  local service="$1" action="$2"
  case "$action" in
    start) start_service "$service" ;;
    stop) stop_service "$service" ;;
    restart) restart_service "$service" ;;
  esac
}

main() {
  if (( $# != 2 )); then
    usage
    return 64
  fi

  local target="$1" action="$2"
  case "$target" in backend|frontend|all) ;; *) usage; return 64 ;; esac
  case "$action" in start|stop|restart) ;; *) usage; return 64 ;; esac

  if [[ "$target" != 'all' ]]; then
    run_one "$target" "$action"
    return
  fi

  case "$action" in
    start)
      local backend_was_running=0
      read_tracked_pid backend >/dev/null && backend_was_running=1
      start_service backend
      if ! start_service frontend; then
        if (( backend_was_running == 0 )); then
          stop_service backend || true
        fi
        return 1
      fi
      ;;
    stop)
      local result=0
      stop_service backend || result=1
      stop_service frontend || result=1
      return "$result"
      ;;
    restart)
      stop_service backend
      stop_service frontend
      start_service backend
      if ! start_service frontend; then
        stop_service backend || true
        return 1
      fi
      ;;
  esac
}

main "$@"
