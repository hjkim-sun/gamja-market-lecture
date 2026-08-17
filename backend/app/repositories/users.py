"""User persistence for FastAPI-owned accounts, independent of Supabase Auth."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from threading import Lock
from typing import Protocol
from uuid import UUID


class EmailAlreadyExistsError(Exception):
    """The database's normalized-email unique constraint was violated."""


@dataclass(frozen=True, slots=True)
class AppUser:
    id: UUID
    email: str
    normalized_email: str
    password_hash: str
    created_at: datetime


class UserRepository(Protocol):
    def create(
        self,
        *,
        user_id: UUID,
        email: str,
        normalized_email: str,
        password_hash: str,
    ) -> AppUser: ...

    def get_by_normalized_email(self, normalized_email: str) -> AppUser | None: ...

    def get_by_id(self, user_id: UUID) -> AppUser | None: ...


class InMemoryUserRepository:
    """Credential-free fallback used by local development and ASGI contract tests."""

    def __init__(self) -> None:
        self._users_by_normalized_email: dict[str, AppUser] = {}
        self._lock = Lock()

    def create(
        self,
        *,
        user_id: UUID,
        email: str,
        normalized_email: str,
        password_hash: str,
    ) -> AppUser:
        with self._lock:
            if normalized_email in self._users_by_normalized_email:
                raise EmailAlreadyExistsError
            user = AppUser(
                id=user_id,
                email=email,
                normalized_email=normalized_email,
                password_hash=password_hash,
                created_at=datetime.now().astimezone(),
            )
            self._users_by_normalized_email[normalized_email] = user
            return user

    def get_by_normalized_email(self, normalized_email: str) -> AppUser | None:
        with self._lock:
            return self._users_by_normalized_email.get(normalized_email)

    def get_by_id(self, user_id: UUID) -> AppUser | None:
        with self._lock:
            return next(
                (user for user in self._users_by_normalized_email.values() if user.id == user_id),
                None,
            )


class PostgresUserRepository:
    """Supabase PostgreSQL repository; migration ownership stays outside the API."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def create(
        self,
        *,
        user_id: UUID,
        email: str,
        normalized_email: str,
        password_hash: str,
    ) -> AppUser:
        # Keep this import lazy so local tests need neither credentials nor a driver.
        from psycopg import IntegrityError, connect

        try:
            with connect(self._database_url) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.app_users (id, email, normalized_email, password_hash)
                        values (%s, %s, %s, %s)
                        returning id, email, normalized_email, password_hash, created_at
                        """,
                        (user_id, email, normalized_email, password_hash),
                    )
                    row = cursor.fetchone()
        except IntegrityError as error:
            if error.sqlstate == "23505":
                raise EmailAlreadyExistsError from error
            raise

        if row is None:  # Defensive guard for an unexpected driver/database result.
            raise RuntimeError("The user insert returned no row")
        return AppUser(*row)

    def get_by_normalized_email(self, normalized_email: str) -> AppUser | None:
        return self._find_one(
            """
            select id, email, normalized_email, password_hash, created_at
            from public.app_users
            where normalized_email = %s
            """,
            (normalized_email,),
        )

    def get_by_id(self, user_id: UUID) -> AppUser | None:
        return self._find_one(
            """
            select id, email, normalized_email, password_hash, created_at
            from public.app_users
            where id = %s
            """,
            (user_id,),
        )

    def _find_one(self, query: str, parameters: tuple[object, ...]) -> AppUser | None:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, parameters)
                row = cursor.fetchone()
        return AppUser(*row) if row is not None else None


def create_user_repository() -> UserRepository:
    """Use Postgres when explicitly configured, otherwise preserve test isolation."""
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return PostgresUserRepository(database_url)
    return InMemoryUserRepository()
