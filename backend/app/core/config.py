"""Environment-backed settings for application-owned browser sessions."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import timedelta
from typing import Mapping


DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60


def _read_positive_int(value: str | None, default: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _read_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


@dataclass(frozen=True, slots=True)
class AuthSettings:
    session_ttl_seconds: int
    cookie_secure: bool
    cookie_name: str = "gm_session"

    @property
    def session_ttl(self) -> timedelta:
        return timedelta(seconds=self.session_ttl_seconds)


def read_auth_settings(environ: Mapping[str, str] | None = None) -> AuthSettings:
    environment = dict(os.environ if environ is None else environ)
    app_environment = environment.get("APP_ENV", "development").strip().lower()
    production = app_environment in {"production", "prod"} or bool(environment.get("VERCEL"))
    requested_secure = environment.get(
        "SESSION_COOKIE_SECURE",
        environment.get("COOKIE_SECURE"),
    )
    return AuthSettings(
        session_ttl_seconds=_read_positive_int(
            environment.get("SESSION_TTL_SECONDS"),
            DEFAULT_SESSION_TTL_SECONDS,
        ),
        cookie_secure=production or _read_bool(requested_secure, False),
    )
