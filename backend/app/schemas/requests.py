"""Request and response models for purchase-request endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


PurchaseRequestCategory = Literal[
    "디지털기기",
    "가구/인테리어",
    "게임/취미",
    "스포츠/레저",
    "생활가전",
    "기타",
]


class CreateRequestInput(BaseModel):
    """Fields supplied by a buyer; ownership and status remain server-owned."""

    model_config = ConfigDict(populate_by_name=True)

    title: str
    category: PurchaseRequestCategory
    desired_price: StrictInt = Field(alias="desiredPrice", ge=1, le=100_000_000)
    description: str

    @field_validator("title", "description")
    @classmethod
    def trim_and_validate_text(cls, value: str, info: object) -> str:
        trimmed = value.strip()
        minimum, maximum = (2, 80) if getattr(info, "field_name", None) == "title" else (10, 2000)
        if not minimum <= len(trimmed) <= maximum:
            raise ValueError("invalid text length")
        return trimmed


class PurchaseRequestOut(BaseModel):
    """Public representation, deliberately excluding the requester id."""

    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    title: str
    category: PurchaseRequestCategory
    desired_price: int = Field(alias="desiredPrice")
    status: str
    description: str
    created_at: datetime = Field(alias="createdAt")
    images: list["RequestImageOut"] = Field(default_factory=list)


class RequestImageOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    url: str
    sort_order: int = Field(alias="sortOrder")


class RequestImageUploadOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    images: list[RequestImageOut]


class PurchaseRequestDetailOut(PurchaseRequestOut):
    """Public detail representation with viewer-specific ownership state."""

    is_owner: bool = Field(alias="isOwner")
    viewer_application_status: str | None = Field(default=None, alias="viewerApplicationStatus")
    viewer_chat_thread_id: UUID | None = Field(default=None, alias="viewerChatThreadId")


class MyPurchaseRequestOut(PurchaseRequestOut):
    """Owner-only request-list representation with a guaranteed application count."""

    application_count: int = Field(alias="applicationCount")


class ApiError(BaseModel):
    code: str
    message: str
