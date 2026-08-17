# 05. Local development service controller design

## Purpose

Provide one project-root command for starting, stopping, and restarting the FastAPI backend and Next.js frontend without treating an unrelated process as disposable.

## Interface

```text
scripts/dev.sh <backend|frontend|all> <start|stop|restart>
```

- Backend starts from `backend/` with `uv run uvicorn app.main:app --reload` on port 8000.
- Frontend starts from `frontend/` with `npm run dev` on port 3000.
- `all start` starts backend then frontend; if frontend cannot start, the backend started by that invocation is stopped.

## Runtime state and safety

The controller writes a numeric PID per service and console output under `.runtime/dev/`, which Git ignores. Each service command is exec'd through macOS-provided `nohup` and a minimal `python3` `os.setsid()` launcher: it first ignores terminal-session hangups, then gets a new session, while retaining the service PID for tracking. `stop` treats absent or stale PID files as success, terminates only the PID recorded by this controller, and removes the PID file only after termination is observed; before a start, `lsof` checks the service port, and a listening foreign process causes a clear failure and is never signalled or killed.

## Verification

The shell contract test covers service commands, PID lifecycle, idempotent stops, restarts, port-conflict rejection, and the `all` target. Shell syntax is checked with `bash -n scripts/dev.sh`.
