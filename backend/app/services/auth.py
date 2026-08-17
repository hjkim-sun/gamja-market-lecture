"""Application use cases for application-owned accounts and sessions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.core.security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)
from app.repositories.sessions import SessionRepository
from app.repositories.users import AppUser, UserRepository
from app.schemas.auth import LoginRequest, SignupRequest


class InvalidCredentialsError(Exception):
    """Login failed without revealing which credential was incorrect."""


class InvalidSessionError(Exception):
    """The supplied session is absent, expired, revoked, or otherwise invalid."""


@dataclass(frozen=True, slots=True)
class LoginResult:
    user: AppUser
    session_token: str


class AuthService:
    def __init__(
        self,
        users: UserRepository,
        sessions: SessionRepository,
        *,
        session_ttl: timedelta,
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._session_ttl = session_ttl

    def signup(self, request: SignupRequest) -> AppUser:
        password_hash = hash_password(request.password)
        return self._users.create(
            user_id=uuid4(),
            email=request.email,
            normalized_email=request.email,
            password_hash=password_hash,
        )

    def login(self, request: LoginRequest) -> LoginResult:
        user = self._users.get_by_normalized_email(request.email)
        if user is None or not verify_password(request.password, user.password_hash):
            raise InvalidCredentialsError

        token = generate_session_token()
        now = datetime.now(UTC)
        self._sessions.create(
            token_hash=hash_session_token(token),
            user_id=user.id,
            expires_at=now + self._session_ttl,
            created_at=now,
        )
        return LoginResult(user=user, session_token=token)

    def logout(self, session_token: str | None) -> None:
        if session_token:
            self._sessions.revoke(
                token_hash=hash_session_token(session_token),
                revoked_at=datetime.now(UTC),
            )

    def me(self, session_token: str | None) -> AppUser:
        if not session_token:
            raise InvalidSessionError

        session = self._sessions.get_valid(
            token_hash=hash_session_token(session_token),
            now=datetime.now(UTC),
        )
        if session is None:
            raise InvalidSessionError

        user = self._users.get_by_id(session.user_id)
        if user is None:
            raise InvalidSessionError
        return user
