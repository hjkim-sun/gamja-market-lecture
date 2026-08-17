"""Persistence for buyer/seller chat threads and messages."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import RLock
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class ChatThread:
    id: UUID
    request_id: UUID
    application_id: UUID
    buyer_id: UUID
    seller_id: UUID
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ChatMessage:
    id: UUID
    thread_id: UUID
    sender_id: UUID
    body: str
    created_at: datetime


class ChatRepository(Protocol):
    def create_thread(
        self, *, thread_id: UUID, request_id: UUID, application_id: UUID, buyer_id: UUID, seller_id: UUID
    ) -> ChatThread: ...

    def list_by_participant(self, user_id: UUID) -> list[ChatThread]: ...

    def get_thread(self, thread_id: UUID) -> ChatThread | None: ...

    def get_by_application(self, application_id: UUID) -> ChatThread | None: ...

    def list_messages(self, thread_id: UUID) -> list[ChatMessage]: ...

    def create_message(self, *, message_id: UUID, thread_id: UUID, sender_id: UUID, body: str) -> ChatMessage: ...


class InMemoryChatRepository:
    def __init__(self) -> None:
        self._threads: dict[UUID, ChatThread] = {}
        self._threads_by_application: dict[UUID, UUID] = {}
        self._messages: dict[UUID, list[ChatMessage]] = {}
        self._lock = RLock()

    def create_thread(
        self, *, thread_id: UUID, request_id: UUID, application_id: UUID, buyer_id: UUID, seller_id: UUID
    ) -> ChatThread:
        with self._lock:
            existing_id = self._threads_by_application.get(application_id)
            if existing_id is not None:
                return self._threads[existing_id]
            thread = ChatThread(thread_id, request_id, application_id, buyer_id, seller_id, datetime.now(UTC))
            self._threads[thread_id] = thread
            self._threads_by_application[application_id] = thread_id
            self._messages[thread_id] = []
            return thread

    def list_by_participant(self, user_id: UUID) -> list[ChatThread]:
        with self._lock:
            return [thread for thread in self._threads.values() if user_id in (thread.buyer_id, thread.seller_id)]

    def get_thread(self, thread_id: UUID) -> ChatThread | None:
        with self._lock:
            return self._threads.get(thread_id)

    def get_by_application(self, application_id: UUID) -> ChatThread | None:
        with self._lock:
            thread_id = self._threads_by_application.get(application_id)
            return self._threads.get(thread_id) if thread_id is not None else None

    def list_messages(self, thread_id: UUID) -> list[ChatMessage]:
        with self._lock:
            return list(self._messages.get(thread_id, []))

    def create_message(self, *, message_id: UUID, thread_id: UUID, sender_id: UUID, body: str) -> ChatMessage:
        message = ChatMessage(message_id, thread_id, sender_id, body, datetime.now(UTC))
        with self._lock:
            self._messages.setdefault(thread_id, []).append(message)
        return message

    def clear(self) -> None:
        with self._lock:
            self._threads.clear()
            self._threads_by_application.clear()
            self._messages.clear()


class PostgresChatRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def create_thread(
        self, *, thread_id: UUID, request_id: UUID, application_id: UUID, buyer_id: UUID, seller_id: UUID
    ) -> ChatThread:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """insert into public.chat_threads (id, request_id, application_id, buyer_id, seller_id)
                       values (%s, %s, %s, %s, %s)
                       returning id, request_id, application_id, buyer_id, seller_id, created_at""",
                    (thread_id, request_id, application_id, buyer_id, seller_id),
                )
                row = cursor.fetchone()
        if row is None:
            raise RuntimeError("The chat thread insert returned no row")
        return ChatThread(*row)

    def list_by_participant(self, user_id: UUID) -> list[ChatThread]:
        return self._threads(
            """select id, request_id, application_id, buyer_id, seller_id, created_at
               from public.chat_threads where buyer_id = %s or seller_id = %s""",
            (user_id, user_id),
        )

    def get_thread(self, thread_id: UUID) -> ChatThread | None:
        rows = self._threads(
            """select id, request_id, application_id, buyer_id, seller_id, created_at
               from public.chat_threads where id = %s""",
            (thread_id,),
        )
        return rows[0] if rows else None

    def get_by_application(self, application_id: UUID) -> ChatThread | None:
        rows = self._threads(
            """select id, request_id, application_id, buyer_id, seller_id, created_at
               from public.chat_threads where application_id = %s""",
            (application_id,),
        )
        return rows[0] if rows else None

    def list_messages(self, thread_id: UUID) -> list[ChatMessage]:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """select id, thread_id, sender_id, body, created_at from public.chat_messages
                       where thread_id = %s order by created_at asc""",
                    (thread_id,),
                )
                rows = cursor.fetchall()
        return [ChatMessage(*row) for row in rows]

    def create_message(self, *, message_id: UUID, thread_id: UUID, sender_id: UUID, body: str) -> ChatMessage:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """insert into public.chat_messages (id, thread_id, sender_id, body)
                       values (%s, %s, %s, %s) returning id, thread_id, sender_id, body, created_at""",
                    (message_id, thread_id, sender_id, body),
                )
                row = cursor.fetchone()
        if row is None:
            raise RuntimeError("The chat message insert returned no row")
        return ChatMessage(*row)

    def _threads(self, query: str, parameters: tuple[object, ...]) -> list[ChatThread]:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, parameters)
                rows = cursor.fetchall()
        return [ChatThread(*row) for row in rows]


def create_chat_repository() -> ChatRepository:
    database_url = os.getenv("DATABASE_URL")
    return PostgresChatRepository(database_url) if database_url else InMemoryChatRepository()
