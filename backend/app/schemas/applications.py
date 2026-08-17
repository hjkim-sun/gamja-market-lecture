"""Request-application request and response contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


class CreateApplicationInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    offered_price: StrictInt = Field(alias="offeredPrice", ge=1, le=100_000_000)
    message: str

    @field_validator("message")
    @classmethod
    def trim_and_validate_message(cls, value: str) -> str:
        value = value.strip()
        if not 10 <= len(value) <= 500:
            raise ValueError("invalid message length")
        return value


class DecideApplicationInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    decision: Literal["accept", "reject"]


class ApplicationOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    request_id: UUID = Field(alias="requestId")
    offered_price: int = Field(alias="offeredPrice")
    message: str
    status: str
    created_at: datetime = Field(alias="createdAt")
    images: list["ApplicationImageOut"] = Field(default_factory=list)


class ApplicationImageOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    url: str
    sort_order: int = Field(alias="sortOrder")


class ApplicationImageUploadOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    images: list[ApplicationImageOut]


class OwnerApplicationOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    seller_display_name: str = Field(alias="sellerDisplayName")
    offered_price: int = Field(alias="offeredPrice")
    message: str
    status: str
    created_at: datetime = Field(alias="createdAt")
    images: list[ApplicationImageOut] = Field(default_factory=list)


class MyApplicationOut(ApplicationOut):
    request_title: str = Field(alias="requestTitle")


class DecisionOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    application: ApplicationOut
    chat_thread_id: UUID | None = Field(default=None, alias="chatThreadId")
