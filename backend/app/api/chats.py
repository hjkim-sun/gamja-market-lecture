"""Authenticated buyer/seller chat endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Cookie, status
from fastapi.responses import JSONResponse

from app.api.dependencies import chats_service
from app.api.requests import _authentication_required_response, _error_response, _not_found_response
from app.schemas.chats import ChatMessageOut, ChatThreadDetailOut, ChatThreadSummaryOut, SendMessageInput
from app.schemas.requests import ApiError
from app.services.auth import InvalidSessionError
from app.services.chats import NotChatParticipantError


chats_router = APIRouter(prefix="/chats", tags=["chats"])


@chats_router.get("", response_model=list[ChatThreadSummaryOut], responses={status.HTTP_401_UNAUTHORIZED: {"model": ApiError}})
def list_chats(gm_session: str | None = Cookie(default=None)) -> list[ChatThreadSummaryOut] | JSONResponse:
    try:
        chats = chats_service.list(gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    return [
        ChatThreadSummaryOut(
            id=summary.thread.id,
            request_id=summary.thread.request_id,
            request_title=summary.request_title,
            counterpart_display_name=summary.counterpart_display_name,
            viewer_role=summary.viewer_role,
            last_message_at=summary.last_message_at,
        )
        for summary in chats
    ]


@chats_router.get(
    "/{thread_id}",
    response_model=ChatThreadDetailOut,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": ApiError}, status.HTTP_403_FORBIDDEN: {"model": ApiError}, status.HTTP_404_NOT_FOUND: {"model": ApiError}},
)
def get_chat(thread_id: str, gm_session: str | None = Cookie(default=None)) -> ChatThreadDetailOut | JSONResponse:
    try:
        parsed_id = UUID(thread_id)
    except ValueError:
        return _not_found_response()
    try:
        thread, request_title, buyer_name, seller_name, viewer_id, messages = chats_service.detail(thread_id=parsed_id, session_token=gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    except LookupError:
        return _not_found_response()
    except NotChatParticipantError:
        return _error_response(status.HTTP_403_FORBIDDEN, "not_chat_participant", "채팅 참여자만 볼 수 있어요.")
    return ChatThreadDetailOut(
        id=thread.id,
        request_id=thread.request_id,
        request_title=request_title,
        buyer_display_name=buyer_name,
        seller_display_name=seller_name,
        viewer_id=viewer_id,
        messages=[ChatMessageOut.model_validate(message, from_attributes=True) for message in messages],
    )


@chats_router.post(
    "/{thread_id}/messages",
    response_model=ChatMessageOut,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_400_BAD_REQUEST: {"model": ApiError}, status.HTTP_401_UNAUTHORIZED: {"model": ApiError}, status.HTTP_403_FORBIDDEN: {"model": ApiError}, status.HTTP_404_NOT_FOUND: {"model": ApiError}},
)
def send_chat_message(thread_id: str, payload: SendMessageInput, gm_session: str | None = Cookie(default=None)) -> ChatMessageOut | JSONResponse:
    try:
        parsed_id = UUID(thread_id)
    except ValueError:
        return _not_found_response()
    try:
        message = chats_service.send(thread_id=parsed_id, payload=payload, session_token=gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    except LookupError:
        return _not_found_response()
    except NotChatParticipantError:
        return _error_response(status.HTTP_403_FORBIDDEN, "not_chat_participant", "채팅 참여자만 메시지를 보낼 수 있어요.")
    return ChatMessageOut.model_validate(message, from_attributes=True)
