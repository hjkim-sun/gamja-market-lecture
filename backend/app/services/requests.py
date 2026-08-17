"""Purchase-request use cases and authenticated ownership assignment."""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import UploadFile

from app.core.images import sanitize_image
from app.core.storage import ImageStorage
from app.repositories.request_images import ImageLimitExceededError, RequestImage, RequestImageRepository
from app.repositories.requests import PurchaseRequest, PurchaseRequestRepository
from app.repositories.applications import ApplicationRepository
from app.schemas.requests import CreateRequestInput
from app.services.auth import AuthService


class NotRequestOwnerError(Exception):
    pass


class PurchaseRequestService:
    def __init__(
        self,
        requests: PurchaseRequestRepository,
        auth: AuthService,
        applications: ApplicationRepository,
        images: RequestImageRepository,
        storage: ImageStorage,
    ) -> None:
        self._requests = requests
        self._auth = auth
        self._applications = applications
        self._images = images
        self._storage = storage

    def create(self, request: CreateRequestInput, session_token: str | None) -> PurchaseRequest:
        user = self._auth.me(session_token)
        return self._requests.create(
            request_id=uuid4(),
            requester_id=user.id,
            title=request.title,
            category=request.category,
            desired_price=request.desired_price,
            description=request.description,
            status="모집중",
        )

    def list(self) -> list[PurchaseRequest]:
        return self._requests.list()

    def list_mine(self, session_token: str | None) -> list[tuple[PurchaseRequest, int]]:
        user = self._auth.me(session_token)
        requests = self._requests.list_by_requester(user.id)
        counts = self._applications.count_by_request_ids([request.id for request in requests])
        return [(request, counts.get(request.id, 0)) for request in requests]

    def get(self, request_id: UUID) -> PurchaseRequest | None:
        return self._requests.get_by_id(request_id)

    def attach_images(self, *, request_id: UUID, uploads: list[UploadFile], session_token: str | None) -> list[RequestImage]:
        user = self._auth.me(session_token)
        request = self._requests.get_by_id(request_id)
        if request is None:
            raise LookupError
        if request.requester_id != user.id:
            raise NotRequestOwnerError
        if not uploads:
            raise ValueError("no_files")
        if len(uploads) > 5:
            raise ImageLimitExceededError
        sanitized = [sanitize_image(upload.file.read()) for upload in uploads]
        pending: list[tuple[UUID, str]] = []
        for content, content_type, extension in sanitized:
            image_id = uuid4()
            path = f"{request_id}/{image_id}.{extension}"
            self._storage.upload(bucket="request-images", path=path, content=content, content_type=content_type)
            pending.append((image_id, path))
        return self._images.insert_batch(request_id=request_id, images=pending)

    def images_for_requests(self, request_ids: list[UUID]) -> dict[UUID, list[RequestImage]]:
        return self._images.list_by_request_ids(request_ids)

    def public_image_url(self, image: RequestImage) -> str:
        return self._storage.public_url(bucket="request-images", path=image.storage_path)
