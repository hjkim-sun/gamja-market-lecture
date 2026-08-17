"""Application use cases for account creation."""

from __future__ import annotations

from uuid import uuid4

from app.core.security import hash_password
from app.repositories.users import AppUser, UserRepository
from app.schemas.auth import SignupRequest


class AuthService:
    def __init__(self, users: UserRepository) -> None:
        self._users = users

    def signup(self, request: SignupRequest) -> AppUser:
        password_hash = hash_password(request.password)
        return self._users.create(
            user_id=uuid4(),
            email=request.email,
            normalized_email=request.email,
            password_hash=password_hash,
        )
