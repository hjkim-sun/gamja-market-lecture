"""Request and response models for the application-owned auth API."""

from __future__ import annotations

import re
from uuid import UUID

from pydantic import BaseModel, field_validator


_EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class SignupRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def normalize_and_validate_email(cls, value: str) -> str:
        normalized_email = value.strip().lower()
        if len(normalized_email) > 320 or not _EMAIL_PATTERN.fullmatch(normalized_email):
            raise ValueError("invalid email address")
        return normalized_email

    @field_validator("password")
    @classmethod
    def validate_password_length(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("password must have at least 8 characters")
        return value


class LoginRequest(SignupRequest):
    """Login accepts the same normalized email and verbatim password shape."""


class PublicUser(BaseModel):
    id: UUID
    email: str


class ApiError(BaseModel):
    code: str
    message: str
