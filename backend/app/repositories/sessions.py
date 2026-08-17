"""Persistence for hashed opaque application sessions."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from datetime import datetime
from threading import Lock
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class AuthSession:
    token_hash: str
    user_id: UUID
    expires_at: datetime
    revoked_at: datetime | None
    created_at: datetime


class SessionRepository(Protocol):
    def create(
        self,
        *,
        token_hash: str,
        user_id: UUID,
        expires_at: datetime,
        created_at: datetime,
    ) -> AuthSession: ...

    def get_valid(self, *, token_hash: str, now: datetime) -> AuthSession | None: ...

    def revoke(self, *, token_hash: str, revoked_at: datetime) -> None: ...


class InMemorySessionRepository:
    """Hashed-token store used when DATABASE_URL is intentionally absent."""

    def __init__(self) -> None:
        self._sessions_by_hash: dict[str, AuthSession] = {}
        self._lock = Lock()

    def create(
        self,
        *,
        token_hash: str,
        user_id: UUID,
        expires_at: datetime,
        created_at: datetime,
    ) -> AuthSession:
        session = AuthSession(
            token_hash=token_hash,
            user_id=user_id,
            expires_at=expires_at,
            revoked_at=None,
            created_at=created_at,
        )
        with self._lock:
            self._sessions_by_hash[token_hash] = session
        return session

    def get_valid(self, *, token_hash: str, now: datetime) -> AuthSession | None:
        with self._lock:
            session = self._sessions_by_hash.get(token_hash)
            if session is None or session.revoked_at is not None or session.expires_at <= now:
                return None
            return session

    def revoke(self, *, token_hash: str, revoked_at: datetime) -> None:
        with self._lock:
            session = self._sessions_by_hash.get(token_hash)
            if session is not None and session.revoked_at is None:
                self._sessions_by_hash[token_hash] = replace(session, revoked_at=revoked_at)

    def clear(self) -> None:
        with self._lock:
            self._sessions_by_hash.clear()


class PostgresSessionRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def create(
        self,
        *,
        token_hash: str,
        user_id: UUID,
        expires_at: datetime,
        created_at: datetime,
    ) -> AuthSession:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    insert into public.auth_sessions
                        (token_hash, user_id, expires_at, created_at)
                    values (%s, %s, %s, %s)
                    returning token_hash, user_id, expires_at, revoked_at, created_at
                    """,
                    (token_hash, user_id, expires_at, created_at),
                )
                row = cursor.fetchone()
        if row is None:
            raise RuntimeError("The session insert returned no row")
        return AuthSession(*row)

    def get_valid(self, *, token_hash: str, now: datetime) -> AuthSession | None:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    select token_hash, user_id, expires_at, revoked_at, created_at
                    from public.auth_sessions
                    where token_hash = %s
                      and revoked_at is null
                      and expires_at > %s
                    """,
                    (token_hash, now),
                )
                row = cursor.fetchone()
        return AuthSession(*row) if row is not None else None

    def revoke(self, *, token_hash: str, revoked_at: datetime) -> None:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    update public.auth_sessions
                    set revoked_at = %s
                    where token_hash = %s and revoked_at is null
                    """,
                    (revoked_at, token_hash),
                )


def create_session_repository() -> SessionRepository:
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return PostgresSessionRepository(database_url)
    return InMemorySessionRepository()
