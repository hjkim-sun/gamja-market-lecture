"""Acceptance tests for runtime-safe conventional backend logging."""

from __future__ import annotations

import importlib
import logging
import re
from collections.abc import Iterator
from pathlib import Path
from uuid import UUID

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
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
    """Keep process-level handlers created for the isolated test from leaking."""
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
def backend_app_with_file_logs(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[FastAPI, Path]:
    """Reload the application against an isolated conventional log directory."""
    log_dir = tmp_path / "runtime-logs"
    monkeypatch.setenv("APP_LOG_DESTINATION", "file")
    monkeypatch.setenv("APP_LOG_DIR", str(log_dir))
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)

    import app.main as main

    return importlib.reload(main).app, log_dir


def test_http_request_log_is_conventional_and_omits_request_secrets(
    backend_app_with_file_logs: tuple[FastAPI, Path],
) -> None:
    """Access records use a fixed safe line and return the same request ID."""
    app, log_dir = backend_app_with_file_logs
    email = "private-buyer@example.com"
    password = "do-not-log-this-password"
    query_secret = "query-secret-value"

    with TestClient(app) as client:
        response = client.post(
            f"/api/auth/signup?tracking={query_secret}",
            json={
                "email": email,
                "password": password,
                "password_confirmation": password,
                "display_name": "로그 구매자",
            },
        )

    assert response.status_code == 201
    request_id = response.headers["X-Request-ID"]
    assert UUID(request_id)

    access_log = log_dir / "access.log"
    error_log = log_dir / "error.log"
    assert access_log.is_file()
    assert error_log.is_file()
    assert not list(log_dir.glob("gamja-backend-*.jsonl*"))

    lines = access_log.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert re.fullmatch(
        rf"\d{{4}}-\d{{2}}-\d{{2}}T\d{{2}}:\d{{2}}:\d{{2}}\.\d{{3}}Z "
        rf"INFO  access request_id={re.escape(request_id)} method=POST "
        rf"route=/api/auth/signup status=201 duration_ms=\d+\.\d{{3}}",
        lines[0],
    )

    raw = access_log.read_text(encoding="utf-8") + error_log.read_text(encoding="utf-8")
    for forbidden in (email, password, query_secret, "email", "password", "tracking", "?"):
        assert forbidden.lower() not in raw.lower()


def test_pathname_only_removes_query_fragment_and_embedded_credentials() -> None:
    """The shared route sanitizer never preserves a request target's secrets."""
    from app.core.logging import pathname_only

    assert pathname_only("https://buyer:password@example.test/api/items?token=secret#fragment") == "/api/items"
    assert pathname_only("/api/auth/signup?tracking=query-secret#top") == "/api/auth/signup"


def test_runtime_log_directories_are_trackable_but_generated_logs_are_ignored() -> None:
    """Repository policy keeps only the intentional runtime-log placeholders."""
    gitignore_lines = (PROJECT_ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()

    assert (PROJECT_ROOT / "backend/logs/.gitkeep").is_file()
    assert (PROJECT_ROOT / "frontend/logs/.gitkeep").is_file()
    assert "backend/logs/*" in gitignore_lines
    assert "!backend/logs/.gitkeep" in gitignore_lines
    assert "frontend/logs/*" in gitignore_lines
    assert "!frontend/logs/.gitkeep" in gitignore_lines
    assert "*.log" not in gitignore_lines
