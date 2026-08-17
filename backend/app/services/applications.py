"""Seller-application use cases and ownership guards."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid4

from fastapi import UploadFile

from app.core.images import sanitize_image
from app.core.storage import ImageStorage
from app.repositories.application_images import ApplicationImage, ApplicationImageRepository
from app.repositories.request_images import ImageLimitExceededError
from app.repositories.applications import (
    ApplicationAlreadyDecidedError,
    ApplicationRepository,
    AlreadyAppliedError,
    RequestApplication,
    RequestNotOpenError,
)
from app.repositories.chats import ChatRepository, ChatThread
from app.repositories.requests import PurchaseRequest, PurchaseRequestRepository
from app.repositories.users import UserRepository
from app.schemas.applications import CreateApplicationInput
from app.services.auth import AuthService, InvalidSessionError


class CannotApplyToOwnRequestError(Exception):
    pass


class NotRequestOwnerError(Exception):
    pass


class NotApplicationOwnerError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class AcceptedApplication:
    application: RequestApplication
    chat_thread_id: UUID


class ApplicationService:
    def __init__(
        self,
        applications: ApplicationRepository,
        requests: PurchaseRequestRepository,
        chats: ChatRepository,
        users: UserRepository,
        auth: AuthService,
        images: ApplicationImageRepository,
        storage: ImageStorage,
    ) -> None:
        self._applications = applications
        self._requests = requests
        self._chats = chats
        self._users = users
        self._auth = auth
        self._images = images
        self._storage = storage

    def create(self, *, request_id: UUID, payload: CreateApplicationInput, session_token: str | None) -> RequestApplication:
        seller = self._auth.me(session_token)
        request = self._request_or_raise(request_id)
        if request.requester_id == seller.id:
            raise CannotApplyToOwnRequestError
        if request.status != "모집중":
            raise RequestNotOpenError
        return self._applications.create(application_id=uuid4(), request_id=request_id, seller_id=seller.id, offered_price=payload.offered_price, message=payload.message)

    def list_for_request(self, *, request_id: UUID, session_token: str | None) -> list[tuple[RequestApplication, str]]:
        viewer = self._auth.me(session_token)
        request = self._request_or_raise(request_id)
        if request.requester_id != viewer.id:
            raise NotRequestOwnerError
        result: list[tuple[RequestApplication, str]] = []
        for application in self._applications.list_by_request(request_id):
            seller = self._users.get_by_id(application.seller_id)
            result.append((application, seller.display_name if seller else "알 수 없는 사용자"))
        return result

    def mine(self, session_token: str | None) -> list[tuple[RequestApplication, PurchaseRequest]]:
        seller = self._auth.me(session_token)
        result: list[tuple[RequestApplication, PurchaseRequest]] = []
        for application in self._applications.list_by_seller(seller.id):
            request = self._requests.get_by_id(application.request_id)
            if request is not None:
                result.append((application, request))
        return result

    def decide(self, *, application_id: UUID, decision: str, session_token: str | None) -> RequestApplication | AcceptedApplication:
        buyer = self._auth.me(session_token)
        application = self._application_or_raise(application_id)
        request = self._request_or_raise(application.request_id)
        if request.requester_id != buyer.id:
            raise NotRequestOwnerError
        if decision == "reject":
            return self._applications.reject(application_id=application_id)
        accepted = self._applications.accept(application_id=application_id, buyer_id=buyer.id, thread_id=uuid4())
        thread = self._chats.get_by_application(accepted.id)
        if thread is None:
            raise RuntimeError("The accepted application did not create a chat thread")
        return AcceptedApplication(application=accepted, chat_thread_id=thread.id)

    def viewer_application(self, *, request_id: UUID, session_token: str | None) -> tuple[RequestApplication | None, ChatThread | None]:
        try:
            viewer = self._auth.me(session_token)
        except InvalidSessionError:
            return None, None
        application = self._applications.get_by_request_and_seller(request_id=request_id, seller_id=viewer.id)
        return application, self._chats.get_by_application(application.id) if application else None

    def attach_images(self, *, application_id: UUID, uploads: list[UploadFile], session_token: str | None) -> list[ApplicationImage]:
        seller = self._auth.me(session_token)
        application = self._application_or_raise(application_id)
        if application.seller_id != seller.id:
            raise NotApplicationOwnerError
        if not uploads:
            raise ValueError("no_files")
        if len(uploads) > 5:
            raise ImageLimitExceededError
        sanitized = [sanitize_image(upload.file.read()) for upload in uploads]
        pending: list[tuple[UUID, str]] = []
        for content, content_type, extension in sanitized:
            image_id = uuid4()
            path = f"{application_id}/{image_id}.{extension}"
            self._storage.upload(bucket="application-images", path=path, content=content, content_type=content_type)
            pending.append((image_id, path))
        return self._images.insert_batch(application_id=application_id, images=pending)

    def images_for_applications(self, application_ids: list[UUID]) -> dict[UUID, list[ApplicationImage]]:
        return self._images.list_by_application_ids(application_ids)

    def signed_image_url(self, image: ApplicationImage) -> str:
        return self._storage.signed_url(bucket="application-images", path=image.storage_path)

    def _request_or_raise(self, request_id: UUID) -> PurchaseRequest:
        request = self._requests.get_by_id(request_id)
        if request is None:
            raise LookupError
        return request

    def _application_or_raise(self, application_id: UUID) -> RequestApplication:
        application = self._applications.get_by_id(application_id)
        if application is None:
            raise LookupError
        return application
