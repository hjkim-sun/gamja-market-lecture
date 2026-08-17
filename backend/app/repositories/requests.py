"""Persistence implementations for buyer-authored purchase requests."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import Protocol
from uuid import UUID

from app.schemas.requests import PurchaseRequestCategory


@dataclass(frozen=True, slots=True)
class PurchaseRequest:
    id: UUID
    requester_id: UUID
    title: str
    category: PurchaseRequestCategory
    desired_price: int
    description: str
    status: str
    created_at: datetime


class PurchaseRequestRepository(Protocol):
    def create(
        self,
        *,
        request_id: UUID,
        requester_id: UUID,
        title: str,
        category: PurchaseRequestCategory,
        desired_price: int,
        description: str,
        status: str,
    ) -> PurchaseRequest: ...

    def list(self) -> list[PurchaseRequest]: ...

    def get_by_id(self, request_id: UUID) -> PurchaseRequest | None: ...


class InMemoryPurchaseRequestRepository:
    """Credential-free repository used by ASGI contract tests and local development."""

    def __init__(self) -> None:
        self._requests_by_id: dict[UUID, PurchaseRequest] = {}
        self._lock = Lock()

    def create(
        self,
        *,
        request_id: UUID,
        requester_id: UUID,
        title: str,
        category: PurchaseRequestCategory,
        desired_price: int,
        description: str,
        status: str,
    ) -> PurchaseRequest:
        request = PurchaseRequest(
            id=request_id,
            requester_id=requester_id,
            title=title,
            category=category,
            desired_price=desired_price,
            description=description,
            status=status,
            created_at=datetime.now(UTC),
        )
        with self._lock:
            self._requests_by_id[request_id] = request
        return request

    def list(self) -> list[PurchaseRequest]:
        with self._lock:
            return sorted(
                self._requests_by_id.values(),
                key=lambda request: request.created_at,
                reverse=True,
            )

    def get_by_id(self, request_id: UUID) -> PurchaseRequest | None:
        with self._lock:
            return self._requests_by_id.get(request_id)


class PostgresPurchaseRequestRepository:
    """Repository for the private FastAPI PostgreSQL connection."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def create(
        self,
        *,
        request_id: UUID,
        requester_id: UUID,
        title: str,
        category: PurchaseRequestCategory,
        desired_price: int,
        description: str,
        status: str,
    ) -> PurchaseRequest:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    insert into public.purchase_requests
                        (id, requester_id, title, category, desired_price, description, status)
                    values (%s, %s, %s, %s, %s, %s, %s)
                    returning id, requester_id, title, category, desired_price,
                              description, status, created_at
                    """,
                    (
                        request_id,
                        requester_id,
                        title,
                        category,
                        desired_price,
                        description,
                        status,
                    ),
                )
                row = cursor.fetchone()
        if row is None:
            raise RuntimeError("The purchase request insert returned no row")
        return PurchaseRequest(*row)

    def list(self) -> list[PurchaseRequest]:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    select id, requester_id, title, category, desired_price,
                           description, status, created_at
                    from public.purchase_requests
                    order by created_at desc
                    """
                )
                rows = cursor.fetchall()
        return [PurchaseRequest(*row) for row in rows]

    def get_by_id(self, request_id: UUID) -> PurchaseRequest | None:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    select id, requester_id, title, category, desired_price,
                           description, status, created_at
                    from public.purchase_requests
                    where id = %s
                    """,
                    (request_id,),
                )
                row = cursor.fetchone()
        return PurchaseRequest(*row) if row is not None else None


def create_purchase_request_repository() -> PurchaseRequestRepository:
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return PostgresPurchaseRequestRepository(database_url)
    return InMemoryPurchaseRequestRepository()
