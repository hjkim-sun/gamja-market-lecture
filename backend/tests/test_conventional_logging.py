"""RED acceptance tests for conventional, process-level backend logging.

These tests intentionally describe the replacement for the legacy date/PID
JSONL logger.  They own all process environment and named logger mutations so
they can run alongside the application's other logging tests.
"""

from __future__ import annotations

import errno
import importlib
import logging
import logging.config
import sys
from collections.abc import Iterator
from pathlib import Path
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


_CONFIGURED_LOGGERS = (
    "gamja.access",
    "gamja.error",
    "gamja.runtime",
    "uvicorn",
    "uvicorn.access",
    "uvicorn.error",
)


@pytest.fixture(autouse=True)
def restore_logging_state() -> Iterator[None]:
    """Leave named logger handlers exactly as they were before each test."""
    snapshots: dict[str, tuple[list[logging.Handler], int, bool, bool]] = {}
    for name in _CONFIGURED_LOGGERS:
        logger = logging.getLogger(name)
        snapshots[name] = (list(logger.handlers), logger.level, logger.propagate, logger.disabled)

    yield

    for name, (handlers, level, propagate, disabled) in snapshots.items():
        logger = logging.getLogger(name)
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
            if handler not in handlers:
                handler.close()
        for handler in handlers:
            logger.addHandler(handler)
        logger.setLevel(level)
        logger.propagate = propagate
        logger.disabled = disabled


@pytest.fixture
def local_logging_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Configure a process-local development file destination."""
    log_dir = tmp_path / "logs"
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("APP_LOG_DESTINATION", "file")
    monkeypatch.setenv("APP_LOG_DIR", str(log_dir))
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    return log_dir


def _reload_application() -> FastAPI:
    import app.main as main

    return importlib.reload(main).app


def _assert_sensitive_data_absent(raw: str, *secrets: str) -> None:
    forbidden = (
        *secrets,
        "email",
        "password",
        "authorization",
        "cookie",
        "token",
        "database_url",
    )
    for value in forbidden:
        assert value.lower() not in raw.lower()


def test_local_request_logging_creates_only_fixed_conventional_files(
    local_logging_environment: Path,
) -> None:
    """A completed request produces one safe access line in fixed local files."""
    app = _reload_application()
    email = "buyer-private@example.com"
    password = "password-must-never-be-logged"
    tracking = "query-secret-value"

    with TestClient(app) as client:
        response = client.post(
            f"/api/auth/signup?tracking={tracking}",
            json={
                "email": email,
                "password": password,
                "password_confirmation": password,
                "display_name": "감자 구매자",
            },
        )

    assert response.status_code == 201
    request_id = response.headers["X-Request-ID"]
    assert UUID(request_id)

    access_log = local_logging_environment / "access.log"
    error_log = local_logging_environment / "error.log"
    assert access_log.is_file()
    assert error_log.is_file()
    assert not list(local_logging_environment.glob("gamja-backend-*.jsonl*"))

    access_lines = access_log.read_text(encoding="utf-8").splitlines()
    assert len(access_lines) == 1
    assert (
        f"INFO  access request_id={request_id} method=POST "
        "route=/api/auth/signup status=201 duration_ms="
    ) in access_lines[0]
    assert "?" not in access_lines[0]
    _assert_sensitive_data_absent("\n".join((access_log.read_text(), error_log.read_text())), email, password, tracking)


def test_unhandled_request_error_and_uvicorn_error_are_safe_and_use_error_log(
    local_logging_environment: Path,
) -> None:
    """Application and Uvicorn failures share error.log without raw error data."""
    app = _reload_application()
    exception_secret = "exception-secret-never-log"

    @app.get("/_test/conventional-logging-error")
    def raise_test_error() -> None:
        raise RuntimeError(exception_secret)

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/_test/conventional-logging-error?token=query-secret")

    assert response.status_code == 500

    # This is the process logger Uvicorn uses for lifecycle and bind failures.
    uvicorn_error = logging.getLogger("uvicorn.error")
    bind_error = OSError(errno.EADDRINUSE, "address already in use: password=leak")
    uvicorn_error.error("raw request target ?token=must-not-appear", exc_info=(OSError, bind_error, None))

    access_raw = (local_logging_environment / "access.log").read_text(encoding="utf-8")
    error_raw = (local_logging_environment / "error.log").read_text(encoding="utf-8")
    assert access_raw.count("access request_id=") == 1
    assert "route=/_test/conventional-logging-error status=500" in access_raw
    assert "event=http_error type=RuntimeError code=unhandled_exception status=500" in error_raw
    assert "event=bind_failed reason=address_in_use" in error_raw
    _assert_sensitive_data_absent(error_raw + access_raw, exception_secret, "query-secret", "must-not-appear")


def test_serverless_process_config_never_creates_files_and_uses_safe_streams(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Vercel ignores a requested file sink and uses stdout/stderr only."""
    log_dir = tmp_path / "serverless-logs"
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("APP_LOG_DESTINATION", "file")
    monkeypatch.setenv("APP_LOG_DIR", str(log_dir))

    from app.core.logging import build_process_log_config

    logging.config.dictConfig(build_process_log_config())
    logging.getLogger("gamja.access").info(
        "raw query ?password=must-not-appear",
    )
    logging.getLogger("uvicorn.error").error(
        "raw authorization Bearer must-not-appear",
    )

    captured = capsys.readouterr()
    assert not log_dir.exists()
    assert "event=server_runtime_error" in captured.err
    assert "access" in captured.out
    _assert_sensitive_data_absent(captured.out + captured.err, "must-not-appear")


def test_development_server_prepares_fixed_logs_before_calling_uvicorn(
    local_logging_environment: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The supported module entry point configures file logging before bind/run."""
    import app.server as server

    observed: dict[str, object] = {}

    def fake_run(*args: object, **kwargs: object) -> None:
        observed["args"] = args
        observed["kwargs"] = kwargs
        assert (local_logging_environment / "access.log").is_file()
        assert (local_logging_environment / "error.log").is_file()

    monkeypatch.setattr(server.uvicorn, "run", fake_run)
    monkeypatch.setattr(sys, "argv", ["app.server", "--port", "9123"])

    server.main()

    assert observed["args"] == ("app.main:app",)
    kwargs = observed["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["port"] == 9123
    assert kwargs["access_log"] is False
    assert isinstance(kwargs["log_config"], dict)
