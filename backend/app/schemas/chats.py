"""Chat request and response contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SendMessageInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    body: str

    @field_validator("body")
    @classmethod
    def trim_and_validate_body(cls, value: str) -> str:
        value = value.strip()
        if not 1 <= len(value) <= 2000:
            raise ValueError("invalid message length")
        return value


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    sender_id: UUID = Field(alias="senderId")
    body: str
    created_at: datetime = Field(alias="createdAt")


class ChatThreadSummaryOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    request_id: UUID = Field(alias="requestId")
    request_title: str = Field(alias="requestTitle")
    counterpart_display_name: str = Field(alias="counterpartDisplayName")
    viewer_role: Literal["buyer", "seller"] = Field(alias="viewerRole")
    last_message_at: datetime | None = Field(alias="lastMessageAt")


class ChatThreadDetailOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    request_id: UUID = Field(alias="requestId")
    request_title: str = Field(alias="requestTitle")
    buyer_display_name: str = Field(alias="buyerDisplayName")
    seller_display_name: str = Field(alias="sellerDisplayName")
    viewer_id: UUID = Field(alias="viewerId")
    messages: list[ChatMessageOut]
