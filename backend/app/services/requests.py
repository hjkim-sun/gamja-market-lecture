"""Purchase-request use cases and authenticated ownership assignment."""

from __future__ import annotations

from uuid import UUID, uuid4

from app.repositories.requests import PurchaseRequest, PurchaseRequestRepository
from app.repositories.applications import ApplicationRepository
from app.schemas.requests import CreateRequestInput
from app.services.auth import AuthService


class PurchaseRequestService:
    def __init__(
        self,
        requests: PurchaseRequestRepository,
        auth: AuthService,
        applications: ApplicationRepository,
    ) -> None:
        self._requests = requests
        self._auth = auth
        self._applications = applications

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
