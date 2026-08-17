"""Safe conventional logging for the backend process.

Only application-owned, allow-listed metadata is ever handed to the logging
system.  This matters because Uvicorn and exception objects can otherwise
include request targets, credentials, or traceback text in their messages.
"""

from __future__ import annotations

import errno
import logging
import logging.config
import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any, Literal, Mapping
from urllib.parse import urlsplit


DEFAULT_LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
MAX_LOG_BYTES = 10 * 1024 * 1024
LOG_BACKUP_COUNT = 4
VALID_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR"})
SENSITIVE_KEY_PARTS = (
    "password",
    "secret",
    "token",
    "authorization",
    "cookie",
    "key",
    "database_url",
    "email",
    "hash",
)


@dataclass(frozen=True, slots=True)
class LogSettings:
    """Validated logging settings derived from environment variables."""

    destination: Literal["file", "stdout"]
    environment: str
    level: str
    log_dir: Path | None
    fallback_reason: str | None = None


def redact_sensitive_data(value: Any) -> Any:
    """Recursively redact conventional credential keys without mutating input."""
    if isinstance(value, Mapping):
        return {
            str(key): (
                "[REDACTED]"
                if any(part in str(key).lower() for part in SENSITIVE_KEY_PARTS)
                else redact_sensitive_data(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_sensitive_data(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_sensitive_data(item) for item in value)
    return value


def pathname_only(value: str) -> str:
    """Keep only a URL pathname, removing query, fragment, and credentials."""
    return urlsplit(value).path or "/"


def _is_serverless(environ: Mapping[str, str]) -> bool:
    return bool(environ.get("VERCEL")) or bool(environ.get("AWS_LAMBDA_FUNCTION_NAME"))


def _read_level(value: str | None) -> str:
    level = (value or "INFO").upper()
    return level if level in VALID_LOG_LEVELS else "INFO"


def _resolve_log_dir(value: str | None) -> Path | None:
    """Resolve a local path without accepting a repo-escaping relative path."""
    if value is None:
        return DEFAULT_LOG_DIR
    if not value.strip():
        return None

    configured = Path(value).expanduser()
    if configured.is_absolute():
        return configured.resolve()

    candidate = (DEFAULT_LOG_DIR.parent / configured).resolve()
    try:
        candidate.relative_to(DEFAULT_LOG_DIR.parent.resolve())
    except ValueError:
        return None
    return candidate


def read_log_settings(environ: Mapping[str, str] | None = None) -> LogSettings:
    """Read safe defaults; malformed configuration must not stop startup."""
    environment = dict(os.environ if environ is None else environ)
    app_environment = environment.get("APP_ENV", "development").strip().lower() or "development"
    requested_destination = environment.get("APP_LOG_DESTINATION", "auto").strip().lower()
    if requested_destination not in {"auto", "file", "stdout"}:
        requested_destination = "auto"

    if _is_serverless(environment):
        return LogSettings(
            destination="stdout",
            environment=app_environment,
            level=_read_level(environment.get("APP_LOG_LEVEL")),
            log_dir=None,
            fallback_reason="serverless_runtime" if requested_destination == "file" else None,
        )

    use_file = requested_destination == "file" or (
        requested_destination == "auto" and app_environment == "development"
    )
    log_dir = _resolve_log_dir(environment.get("APP_LOG_DIR")) if use_file else None
    return LogSettings(
        destination="file" if use_file and log_dir is not None else "stdout",
        environment=app_environment,
        level=_read_level(environment.get("APP_LOG_LEVEL")),
        log_dir=log_dir,
        fallback_reason="invalid_log_directory" if use_file and log_dir is None else None,
    )


def _timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class SafeRuntimeFormatter(logging.Formatter):
    """Render only fields explicitly supplied by :class:`RuntimeLogger`."""

    def format(self, record: logging.LogRecord) -> str:
        payload = getattr(record, "safe_payload", {})
        if not isinstance(payload, Mapping):
            payload = {}

        event = payload.get("event")
        if event == "http_request" or record.name == "gamja.access":
            request_id = str(payload.get("request_id", "unknown"))
            method = str(payload.get("method", "UNKNOWN")).upper()
            route = pathname_only(str(payload.get("route", "/")))
            status = _safe_status(payload.get("status_code"))
            duration = _safe_duration(payload.get("duration_ms"))
            return (
                f"{_timestamp()} {record.levelname:<5} access request_id={request_id} "
                f"method={method} route={route} status={status} duration_ms={duration}"
            )

        error_type = _safe_identifier(payload.get("error_type"), "RuntimeError")
        error_code = _safe_identifier(payload.get("error_code"), "server_runtime_error")
        status = _safe_status(payload.get("status_code"))
        event_name = _safe_identifier(event, "server_runtime_error")
        return (
            f"{_timestamp()} {record.levelname:<5} error event={event_name} "
            f"type={error_type} code={error_code} status={status}"
        )


class SafeUvicornFormatter(logging.Formatter):
    """Classify Uvicorn records without ever rendering their raw message."""

    def format(self, record: logging.LogRecord) -> str:
        exception = record.exc_info[1] if record.exc_info else None
        # Uvicorn's bind failure is commonly a formatted message rather than
        # an ``exc_info`` record.  Inspect it solely for classification and
        # never include it in the rendered line.
        raw_for_classification = f"{record.msg!s} {record.args!s}".lower()
        if (isinstance(exception, OSError) and exception.errno == errno.EADDRINUSE) or (
            "address already in use" in raw_for_classification or "eaddrinuse" in raw_for_classification
        ):
            event = "bind_failed reason=address_in_use"
        else:
            event = "server_runtime_error"
        return f"{_timestamp()} {record.levelname:<5} uvicorn event={event}"


class SafeErrorFormatter(logging.Formatter):
    """Use the runtime format for Gamja records and Uvicorn's safe classifier otherwise."""

    def __init__(self) -> None:
        super().__init__()
        self._runtime = SafeRuntimeFormatter()
        self._uvicorn = SafeUvicornFormatter()

    def format(self, record: logging.LogRecord) -> str:
        if record.name.startswith("uvicorn"):
            return self._uvicorn.format(record)
        return self._runtime.format(record)


def _safe_status(value: object) -> int:
    try:
        status = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 500
    return status if 100 <= status <= 599 else 500


def _safe_duration(value: object) -> str:
    try:
        duration = max(0.0, float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        duration = 0.0
    return f"{duration:.3f}"


def _safe_identifier(value: object, fallback: str) -> str:
    text = str(value or fallback)
    return text if text.replace("_", "").replace("-", "").isalnum() else fallback


def _file_handler(filename: Path, formatter: str) -> dict[str, object]:
    return {
        "class": "logging.handlers.RotatingFileHandler",
        "level": "DEBUG",
        "formatter": formatter,
        "filename": str(filename),
        "maxBytes": MAX_LOG_BYTES,
        "backupCount": LOG_BACKUP_COUNT,
        "encoding": "utf-8",
    }


def build_process_log_config(environ: Mapping[str, str] | None = None) -> dict[str, object]:
    """Build the complete safe process logging configuration.

    Local file directories are prepared before Uvicorn creates its socket.  A
    serverless setting never touches the filesystem, even if ``file`` was
    explicitly requested.
    """
    settings = read_log_settings(environ)
    use_files = settings.destination == "file" and settings.log_dir is not None
    if use_files:
        try:
            settings.log_dir.mkdir(parents=True, exist_ok=True)
            if not settings.log_dir.is_dir():
                raise NotADirectoryError(settings.log_dir)
        except OSError:
            use_files = False

    if use_files:
        assert settings.log_dir is not None
        handlers: dict[str, dict[str, object]] = {
            "access": _file_handler(settings.log_dir / "access.log", "runtime"),
            "error": _file_handler(settings.log_dir / "error.log", "error"),
        }
    else:
        handlers = {
            "access": {
                "class": "logging.StreamHandler",
                "level": "DEBUG",
                "formatter": "runtime",
                "stream": "ext://sys.stdout",
            },
            "error": {
                "class": "logging.StreamHandler",
                "level": "DEBUG",
                "formatter": "error",
                "stream": "ext://sys.stderr",
            },
        }

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "runtime": {"()": "app.core.logging.SafeRuntimeFormatter"},
            "error": {"()": "app.core.logging.SafeErrorFormatter"},
        },
        "handlers": handlers,
        "loggers": {
            "gamja.access": {"handlers": ["access"], "level": settings.level, "propagate": False},
            "gamja.error": {"handlers": ["error"], "level": settings.level, "propagate": False},
            # Preserve this legacy name as a safe, non-file-root logger.
            "gamja.runtime": {"handlers": ["error"], "level": settings.level, "propagate": False},
            "uvicorn": {"handlers": ["error"], "level": settings.level, "propagate": False},
            "uvicorn.error": {"handlers": ["error"], "level": settings.level, "propagate": False},
            "uvicorn.access": {"handlers": [], "level": "WARNING", "propagate": False},
        },
    }


def configure_process_logging(environ: Mapping[str, str] | None = None) -> dict[str, object]:
    """Apply process config, falling back to safe streams if files cannot open."""
    log_config = build_process_log_config(environ)
    try:
        logging.config.dictConfig(log_config)
        return log_config
    except Exception:
        fallback_environ = dict(os.environ if environ is None else environ)
        fallback_environ["APP_LOG_DESTINATION"] = "stdout"
        log_config = build_process_log_config(fallback_environ)
        logging.config.dictConfig(log_config)
        logging.getLogger("gamja.error").warning(
            "safe logging fallback",
            extra={
                "safe_payload": {
                    "event": "log_sink_unavailable",
                    "error_type": "LoggingSink",
                    "error_code": "file_sink_unavailable",
                    "status_code": 500,
                }
            },
        )
        return log_config


class RuntimeLogger:
    """A narrow facade that routes safe request events to named loggers."""

    def __init__(self, settings: LogSettings) -> None:
        self.settings = settings
        self._access_logger = logging.getLogger("gamja.access")
        self._error_logger = logging.getLogger("gamja.error")

    def event(self, event: str, _message: str = "", *, level: str = "INFO", **fields: object) -> None:
        payload: dict[str, object] = {"event": event}
        payload.update(
            {
                name: fields[name]
                for name in ("request_id", "method", "route", "status_code", "duration_ms", "error_type", "error_code")
                if name in fields and fields[name] is not None
            }
        )
        logger = self._access_logger if event == "http_request" else self._error_logger
        try:
            logger.log(getattr(logging, _read_level(level)), "safe runtime event", extra={"safe_payload": payload})
        except Exception:
            # Logging failures must never alter the response outcome.
            pass

    def close(self) -> None:
        """Process logging outlives an ASGI lifespan; there is nothing to close."""


def configure_runtime_logging(environ: Mapping[str, str] | None = None) -> RuntimeLogger:
    """Apply safe process config for imports/serverless adapters and return the facade."""
    settings = read_log_settings(environ)
    configure_process_logging(environ)
    return RuntimeLogger(settings)


class RequestTimer:
    """Tiny timing helper that keeps timing implementation out of middleware logic."""

    def __init__(self) -> None:
        self._started_at = perf_counter()

    @property
    def duration_ms(self) -> float:
        return round((perf_counter() - self._started_at) * 1000, 3)
