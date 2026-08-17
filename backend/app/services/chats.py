"""Chat list, detail, and message-sending use cases."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from app.repositories.chats import ChatMessage, ChatRepository, ChatThread
from app.repositories.requests import PurchaseRequestRepository
from app.repositories.users import UserRepository
from app.schemas.chats import SendMessageInput
from app.services.auth import AuthService


class NotChatParticipantError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class ChatSummary:
    thread: ChatThread
    request_title: str
    counterpart_display_name: str
    viewer_role: str
    last_message_at: datetime | None


class ChatService:
    def __init__(self, chats: ChatRepository, requests: PurchaseRequestRepository, users: UserRepository, auth: AuthService) -> None:
        self._chats = chats
        self._requests = requests
        self._users = users
        self._auth = auth

    def list(self, session_token: str | None) -> list[ChatSummary]:
        viewer = self._auth.me(session_token)
        summaries: list[ChatSummary] = []
        for thread in self._chats.list_by_participant(viewer.id):
            request = self._requests.get_by_id(thread.request_id)
            counterpart_id = thread.seller_id if viewer.id == thread.buyer_id else thread.buyer_id
            counterpart = self._users.get_by_id(counterpart_id)
            messages = self._chats.list_messages(thread.id)
            summaries.append(ChatSummary(thread, request.title if request else "삭제된 요청", counterpart.display_name if counterpart else "알 수 없는 사용자", "buyer" if viewer.id == thread.buyer_id else "seller", messages[-1].created_at if messages else thread.created_at))
        return sorted(summaries, key=lambda item: item.last_message_at or item.thread.created_at, reverse=True)

    def detail(self, *, thread_id: UUID, session_token: str | None) -> tuple[ChatThread, str, str, str, UUID, list[ChatMessage]]:
        viewer = self._auth.me(session_token)
        thread = self._thread_or_raise(thread_id)
        self._require_participant(thread, viewer.id)
        request = self._requests.get_by_id(thread.request_id)
        buyer = self._users.get_by_id(thread.buyer_id)
        seller = self._users.get_by_id(thread.seller_id)
        return (thread, request.title if request else "삭제된 요청", buyer.display_name if buyer else "알 수 없는 사용자", seller.display_name if seller else "알 수 없는 사용자", viewer.id, self._chats.list_messages(thread_id))

    def send(self, *, thread_id: UUID, payload: SendMessageInput, session_token: str | None) -> ChatMessage:
        viewer = self._auth.me(session_token)
        thread = self._thread_or_raise(thread_id)
        self._require_participant(thread, viewer.id)
        return self._chats.create_message(message_id=uuid4(), thread_id=thread_id, sender_id=viewer.id, body=payload.body)

    def _thread_or_raise(self, thread_id: UUID) -> ChatThread:
        thread = self._chats.get_thread(thread_id)
        if thread is None:
            raise LookupError
        return thread

    @staticmethod
    def _require_participant(thread: ChatThread, user_id: UUID) -> None:
        if user_id not in (thread.buyer_id, thread.seller_id):
            raise NotChatParticipantError
