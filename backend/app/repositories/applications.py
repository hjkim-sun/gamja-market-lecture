"""Persistence and atomic decision handling for seller applications."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from threading import RLock
from typing import Protocol
from uuid import UUID

from app.repositories.chats import ChatRepository
from app.repositories.requests import PurchaseRequestRepository


class AlreadyAppliedError(Exception):
    pass


class ApplicationAlreadyDecidedError(Exception):
    pass


class RequestNotOpenError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class RequestApplication:
    id: UUID
    request_id: UUID
    seller_id: UUID
    offered_price: int
    message: str
    status: str
    created_at: datetime
    decided_at: datetime | None


class ApplicationRepository(Protocol):
    def create(self, *, application_id: UUID, request_id: UUID, seller_id: UUID, offered_price: int, message: str) -> RequestApplication: ...
    def list_by_request(self, request_id: UUID) -> list[RequestApplication]: ...
    def list_by_seller(self, seller_id: UUID) -> list[RequestApplication]: ...
    def count_by_request_ids(self, request_ids: list[UUID]) -> dict[UUID, int]: ...
    def get_by_id(self, application_id: UUID) -> RequestApplication | None: ...
    def get_by_request_and_seller(self, *, request_id: UUID, seller_id: UUID) -> RequestApplication | None: ...
    def accept(self, *, application_id: UUID, buyer_id: UUID, thread_id: UUID) -> RequestApplication: ...
    def reject(self, *, application_id: UUID) -> RequestApplication: ...


class InMemoryApplicationRepository:
    def __init__(self, requests: PurchaseRequestRepository, chats: ChatRepository) -> None:
        self._requests = requests
        self._chats = chats
        self._applications: dict[UUID, RequestApplication] = {}
        self._by_request_seller: dict[tuple[UUID, UUID], UUID] = {}
        self._lock = RLock()

    def create(self, *, application_id: UUID, request_id: UUID, seller_id: UUID, offered_price: int, message: str) -> RequestApplication:
        with self._lock:
            key = (request_id, seller_id)
            if key in self._by_request_seller:
                raise AlreadyAppliedError
            application = RequestApplication(application_id, request_id, seller_id, offered_price, message, "대기중", datetime.now(UTC), None)
            self._applications[application_id] = application
            self._by_request_seller[key] = application_id
            return application

    def list_by_request(self, request_id: UUID) -> list[RequestApplication]:
        with self._lock:
            return sorted((a for a in self._applications.values() if a.request_id == request_id), key=lambda a: a.created_at, reverse=True)

    def list_by_seller(self, seller_id: UUID) -> list[RequestApplication]:
        with self._lock:
            return sorted((a for a in self._applications.values() if a.seller_id == seller_id), key=lambda a: a.created_at, reverse=True)

    def count_by_request_ids(self, request_ids: list[UUID]) -> dict[UUID, int]:
        requested = set(request_ids)
        if not requested:
            return {}
        with self._lock:
            counts = {request_id: 0 for request_id in requested}
            for application in self._applications.values():
                if application.request_id in counts:
                    counts[application.request_id] += 1
            return counts

    def get_by_id(self, application_id: UUID) -> RequestApplication | None:
        with self._lock:
            return self._applications.get(application_id)

    def get_by_request_and_seller(self, *, request_id: UUID, seller_id: UUID) -> RequestApplication | None:
        with self._lock:
            application_id = self._by_request_seller.get((request_id, seller_id))
            return self._applications.get(application_id) if application_id else None

    def accept(self, *, application_id: UUID, buyer_id: UUID, thread_id: UUID) -> RequestApplication:
        with self._lock:
            application = self._require_pending(application_id)
            request = self._requests.get_by_id(application.request_id)
            if request is None or request.status != "모집중":
                raise RequestNotOpenError
            now = datetime.now(UTC)
            accepted = replace(application, status="수락됨", decided_at=now)
            self._applications[application_id] = accepted
            for other_id, other in self._applications.items():
                if other.request_id == application.request_id and other_id != application_id and other.status == "대기중":
                    self._applications[other_id] = replace(other, status="거절됨", decided_at=now)
            self._requests.update_status(application.request_id, "협의중")
            self._chats.create_thread(thread_id=thread_id, request_id=application.request_id, application_id=application.id, buyer_id=buyer_id, seller_id=application.seller_id)
            return accepted

    def reject(self, *, application_id: UUID) -> RequestApplication:
        with self._lock:
            application = self._require_pending(application_id)
            rejected = replace(application, status="거절됨", decided_at=datetime.now(UTC))
            self._applications[application_id] = rejected
            return rejected

    def _require_pending(self, application_id: UUID) -> RequestApplication:
        application = self._applications.get(application_id)
        if application is None:
            raise RuntimeError("application must be checked before decision")
        if application.status != "대기중":
            raise ApplicationAlreadyDecidedError
        return application

    def clear(self) -> None:
        with self._lock:
            self._applications.clear()
            self._by_request_seller.clear()


class PostgresApplicationRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def create(self, *, application_id: UUID, request_id: UUID, seller_id: UUID, offered_price: int, message: str) -> RequestApplication:
        from psycopg import IntegrityError, connect

        try:
            with connect(self._database_url) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """insert into public.request_applications (id, request_id, seller_id, offered_price, message)
                           values (%s, %s, %s, %s, %s)
                           returning id, request_id, seller_id, offered_price, message, status, created_at, decided_at""",
                        (application_id, request_id, seller_id, offered_price, message),
                    )
                    row = cursor.fetchone()
        except IntegrityError as error:
            if error.sqlstate == "23505" and error.diag.constraint_name == "request_applications_unique_seller_per_request":
                raise AlreadyAppliedError from error
            raise
        if row is None:
            raise RuntimeError("The application insert returned no row")
        return RequestApplication(*row)

    def list_by_request(self, request_id: UUID) -> list[RequestApplication]:
        return self._many("where request_id = %s order by created_at desc", (request_id,))

    def list_by_seller(self, seller_id: UUID) -> list[RequestApplication]:
        return self._many("where seller_id = %s order by created_at desc", (seller_id,))

    def count_by_request_ids(self, request_ids: list[UUID]) -> dict[UUID, int]:
        if not request_ids:
            return {}
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "select request_id, count(*) from public.request_applications where request_id = any(%s) group by request_id",
                    (request_ids,),
                )
                return {row[0]: row[1] for row in cursor.fetchall()}

    def get_by_id(self, application_id: UUID) -> RequestApplication | None:
        rows = self._many("where id = %s", (application_id,))
        return rows[0] if rows else None

    def get_by_request_and_seller(self, *, request_id: UUID, seller_id: UUID) -> RequestApplication | None:
        rows = self._many("where request_id = %s and seller_id = %s", (request_id, seller_id))
        return rows[0] if rows else None

    def accept(self, *, application_id: UUID, buyer_id: UUID, thread_id: UUID) -> RequestApplication:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select id, request_id, seller_id, offered_price, message, status, created_at, decided_at from public.request_applications where id = %s for update", (application_id,))
                row = cursor.fetchone()
                if row is None:
                    raise RuntimeError("application must be checked before decision")
                application = RequestApplication(*row)
                if application.status != "대기중":
                    raise ApplicationAlreadyDecidedError
                cursor.execute("select status from public.purchase_requests where id = %s for update", (application.request_id,))
                request_row = cursor.fetchone()
                if request_row is None or request_row[0] != "모집중":
                    raise RequestNotOpenError
                cursor.execute("update public.request_applications set status = '수락됨', decided_at = timezone('utc', now()) where id = %s returning id, request_id, seller_id, offered_price, message, status, created_at, decided_at", (application_id,))
                accepted_row = cursor.fetchone()
                cursor.execute("update public.request_applications set status = '거절됨', decided_at = timezone('utc', now()) where request_id = %s and id <> %s and status = '대기중'", (application.request_id, application_id))
                cursor.execute("update public.purchase_requests set status = '협의중' where id = %s", (application.request_id,))
                cursor.execute("insert into public.chat_threads (id, request_id, application_id, buyer_id, seller_id) values (%s, %s, %s, %s, %s)", (thread_id, application.request_id, application.id, buyer_id, application.seller_id))
        if accepted_row is None:
            raise RuntimeError("The accepted application update returned no row")
        return RequestApplication(*accepted_row)

    def reject(self, *, application_id: UUID) -> RequestApplication:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select status from public.request_applications where id = %s for update", (application_id,))
                row = cursor.fetchone()
                if row is None:
                    raise RuntimeError("application must be checked before decision")
                if row[0] != "대기중":
                    raise ApplicationAlreadyDecidedError
                cursor.execute("update public.request_applications set status = '거절됨', decided_at = timezone('utc', now()) where id = %s returning id, request_id, seller_id, offered_price, message, status, created_at, decided_at", (application_id,))
                updated = cursor.fetchone()
        if updated is None:
            raise RuntimeError("The rejected application update returned no row")
        return RequestApplication(*updated)

    def _many(self, where: str, parameters: tuple[object, ...]) -> list[RequestApplication]:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select id, request_id, seller_id, offered_price, message, status, created_at, decided_at from public.request_applications " + where, parameters)
                rows = cursor.fetchall()
        return [RequestApplication(*row) for row in rows]


def create_application_repository(requests: PurchaseRequestRepository, chats: ChatRepository) -> ApplicationRepository:
    database_url = os.getenv("DATABASE_URL")
    return PostgresApplicationRepository(database_url) if database_url else InMemoryApplicationRepository(requests, chats)
