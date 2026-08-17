"""Small image-storage adapter with an offline in-memory implementation."""

from __future__ import annotations

import os
from threading import RLock
from typing import Protocol

import httpx


class ImageStorage(Protocol):
    def upload(self, *, bucket: str, path: str, content: bytes, content_type: str) -> None: ...
    def public_url(self, *, bucket: str, path: str) -> str: ...
    def signed_url(self, *, bucket: str, path: str, expires_in: int = 300) -> str: ...


class InMemoryImageStorage:
    """Credential-free storage used by local development and contract tests."""

    def __init__(self) -> None:
        self._objects: dict[tuple[str, str], bytes] = {}
        self._lock = RLock()

    def upload(self, *, bucket: str, path: str, content: bytes, content_type: str) -> None:
        del content_type
        with self._lock:
            self._objects[(bucket, path)] = content

    def public_url(self, *, bucket: str, path: str) -> str:
        return f"memory://{bucket}/public/{path}"

    def signed_url(self, *, bucket: str, path: str, expires_in: int = 300) -> str:
        del expires_in
        return f"memory://{bucket}/signed/{path}"

    def clear(self) -> None:
        with self._lock:
            self._objects.clear()


class SupabaseImageStorage:
    def __init__(self, supabase_url: str, service_role_key: str) -> None:
        self._base_url = supabase_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {service_role_key}", "apikey": service_role_key}

    def upload(self, *, bucket: str, path: str, content: bytes, content_type: str) -> None:
        response = httpx.post(
            f"{self._base_url}/storage/v1/object/{bucket}/{path}",
            headers={**self._headers, "Content-Type": content_type, "x-upsert": "false"},
            content=content,
            timeout=15,
        )
        response.raise_for_status()

    def public_url(self, *, bucket: str, path: str) -> str:
        return f"{self._base_url}/storage/v1/object/public/{bucket}/{path}"

    def signed_url(self, *, bucket: str, path: str, expires_in: int = 300) -> str:
        response = httpx.post(
            f"{self._base_url}/storage/v1/object/sign/{bucket}/{path}",
            headers=self._headers,
            json={"expiresIn": expires_in},
            timeout=15,
        )
        response.raise_for_status()
        signed_url = response.json().get("signedURL")
        if not isinstance(signed_url, str):
            raise RuntimeError("Supabase Storage did not return a signed URL")
        return signed_url if signed_url.startswith("http") else f"{self._base_url}{signed_url}"


def create_image_storage() -> ImageStorage:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    return SupabaseImageStorage(url, key) if url and key else InMemoryImageStorage()
