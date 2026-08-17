"""Metadata persistence for private seller-application images."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import RLock
from typing import Protocol
from uuid import UUID

from app.repositories.request_images import ImageLimitExceededError


@dataclass(frozen=True, slots=True)
class ApplicationImage:
    id: UUID
    application_id: UUID
    storage_path: str
    sort_order: int
    created_at: datetime


class ApplicationImageRepository(Protocol):
    def insert_batch(self, *, application_id: UUID, images: list[tuple[UUID, str]]) -> list[ApplicationImage]: ...
    def list_by_application_ids(self, application_ids: list[UUID]) -> dict[UUID, list[ApplicationImage]]: ...


class InMemoryApplicationImageRepository:
    def __init__(self) -> None:
        self._images: dict[UUID, list[ApplicationImage]] = {}
        self._lock = RLock()

    def insert_batch(self, *, application_id: UUID, images: list[tuple[UUID, str]]) -> list[ApplicationImage]:
        with self._lock:
            existing = self._images.setdefault(application_id, [])
            if len(existing) + len(images) > 5:
                raise ImageLimitExceededError
            created = [ApplicationImage(image_id, application_id, path, len(existing) + index, datetime.now(UTC)) for index, (image_id, path) in enumerate(images)]
            existing.extend(created)
            return created

    def list_by_application_ids(self, application_ids: list[UUID]) -> dict[UUID, list[ApplicationImage]]:
        with self._lock:
            return {application_id: list(self._images.get(application_id, [])) for application_id in application_ids}

    def clear(self) -> None:
        with self._lock:
            self._images.clear()


class PostgresApplicationImageRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def insert_batch(self, *, application_id: UUID, images: list[tuple[UUID, str]]) -> list[ApplicationImage]:
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select id from public.request_applications where id = %s for update", (application_id,))
                cursor.execute("select count(*) from public.application_images where application_id = %s", (application_id,))
                existing_count = cursor.fetchone()[0]
                if existing_count + len(images) > 5:
                    raise ImageLimitExceededError
                created: list[ApplicationImage] = []
                for offset, (image_id, path) in enumerate(images):
                    cursor.execute("""insert into public.application_images (id, application_id, storage_path, sort_order)
                        values (%s, %s, %s, %s) returning id, application_id, storage_path, sort_order, created_at""", (image_id, application_id, path, existing_count + offset))
                    row = cursor.fetchone()
                    if row is None:
                        raise RuntimeError("The application image insert returned no row")
                    created.append(ApplicationImage(*row))
        return created

    def list_by_application_ids(self, application_ids: list[UUID]) -> dict[UUID, list[ApplicationImage]]:
        result = {application_id: [] for application_id in application_ids}
        if not application_ids:
            return result
        from psycopg import connect

        with connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select id, application_id, storage_path, sort_order, created_at from public.application_images where application_id = any(%s) order by application_id, sort_order", (application_ids,))
                for row in cursor.fetchall():
                    image = ApplicationImage(*row)
                    result.setdefault(image.application_id, []).append(image)
        return result


def create_application_image_repository() -> ApplicationImageRepository:
    database_url = os.getenv("DATABASE_URL")
    return PostgresApplicationImageRepository(database_url) if database_url else InMemoryApplicationImageRepository()
