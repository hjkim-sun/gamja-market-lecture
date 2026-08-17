"""Request and response models for the application-owned auth API."""

from __future__ import annotations

import re
from uuid import UUID

from pydantic import BaseModel, field_validator, model_validator


_EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class CredentialsRequest(BaseModel):
    """Shared normalized credential fields used by signup and login."""

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


class SignupRequest(CredentialsRequest):
    password_confirmation: str
    display_name: str

    @field_validator("display_name")
    @classmethod
    def normalize_and_validate_display_name(cls, value: str) -> str:
        normalized_display_name = value.strip()
        if not 1 <= len(normalized_display_name) <= 40:
            raise ValueError("display name must be between 1 and 40 characters")
        return normalized_display_name

    @model_validator(mode="after")
    def validate_password_confirmation(self) -> SignupRequest:
        if self.password_confirmation != self.password:
            raise ValueError("password confirmation must match password")
        return self


class LoginRequest(CredentialsRequest):
    """Login accepts the same normalized email and verbatim password shape."""


class PublicUser(BaseModel):
    id: UUID
    email: str
    display_name: str


class ApiError(BaseModel):
    code: str
    message: str
