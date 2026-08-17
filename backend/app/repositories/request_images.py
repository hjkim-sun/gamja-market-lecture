"""Metadata persistence for public purchase-request images."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import RLock
from typing import Protocol
from uuid import UUID


class ImageLimitExceededError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class RequestImage:
    id: UUID
    request_id: UUID
    storage_path: str
    sort_order: int
    created_at: datetime


class RequestImageRepository(Protocol):
    def insert_batch(self, *, request_id: UUID, images: list[tuple[UUID, str]]) -> list[RequestImage]: ...
    def list_by_request_ids(self, request_ids: list[UUID]) -> dict[UUID, list[RequestImage]]: ...


class InMemoryRequestImageRepository:
    def __init__(self) -> None:
        self._images: dict[UUID, list[RequestImage]] = {}
        self._lock = RLock()

    def insert_batch(self, *, request_id: UUID, images: list[tuple[UUID, str]]) -> list[RequestImage]:
        with self._lock:
            existing = self._images.setdefault(request_id, [])
            if len(existing) + len(images) > 5:
                raise ImageLimitExceededError
            created = [RequestImage(image_id, request_id, path, len(existing) + index, datetime.now(UTC)) for index, (image_id, path) in enumerate(images)]
            existing.extend(created)
            return created

    def list_by_request_ids(self, request_ids: list[UUID]) -> dict[UUID, list[RequestImage]]:
        with self._lock:
            return {request_id: list(self._images.get(request_id, [])) for request_id in request_ids}

    def clear(self) -> None:
        with self._lock:
            self._images.clear()


class PostgresRequestImageRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def insert_batch(self, *, request_id: UUID, images: list[tuple[UUID, str]]) -> list[RequestImage]:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select id from public.purchase_requests where id = %s for update", (request_id,))
                cursor.execute("select count(*) from public.request_images where request_id = %s", (request_id,))
                existing_count = cursor.fetchone()[0]
                if existing_count + len(images) > 5:
                    raise ImageLimitExceededError
                created: list[RequestImage] = []
                for offset, (image_id, path) in enumerate(images):
                    cursor.execute("""insert into public.request_images (id, request_id, storage_path, sort_order)
                        values (%s, %s, %s, %s) returning id, request_id, storage_path, sort_order, created_at""", (image_id, request_id, path, existing_count + offset))
                    row = cursor.fetchone()
                    if row is None:
                        raise RuntimeError("The request image insert returned no row")
                    created.append(RequestImage(*row))
        return created

    def list_by_request_ids(self, request_ids: list[UUID]) -> dict[UUID, list[RequestImage]]:
        result = {request_id: [] for request_id in request_ids}
        if not request_ids:
            return result
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select id, request_id, storage_path, sort_order, created_at from public.request_images where request_id = any(%s) order by request_id, sort_order", (request_ids,))
                for row in cursor.fetchall():
                    image = RequestImage(*row)
                    result.setdefault(image.request_id, []).append(image)
        return result


def create_request_image_repository() -> RequestImageRepository:
    database_url = os.getenv("DATABASE_URL")
    return PostgresRequestImageRepository(database_url) if database_url else InMemoryRequestImageRepository()
