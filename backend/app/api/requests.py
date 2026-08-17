"""Public read and authenticated creation endpoints for purchase requests."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Cookie, status
from fastapi.responses import JSONResponse

from app.api.auth import _auth_service
from app.repositories.requests import create_purchase_request_repository
from app.schemas.requests import ApiError, CreateRequestInput, PurchaseRequestOut
from app.services.auth import InvalidSessionError
from app.services.requests import PurchaseRequestService


requests_router = APIRouter(prefix="/requests", tags=["requests"])
_requests_service = PurchaseRequestService(create_purchase_request_repository(), _auth_service)


def _not_found_response() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"code": "not_found", "message": "구매요청을 찾을 수 없어요."},
    )


@requests_router.post(
    "",
    response_model=PurchaseRequestOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": ApiError},
        status.HTTP_401_UNAUTHORIZED: {"model": ApiError},
    },
)
def create_purchase_request(
    request: CreateRequestInput,
    gm_session: str | None = Cookie(default=None),
) -> PurchaseRequestOut | JSONResponse:
    try:
        created = _requests_service.create(request, gm_session)
    except InvalidSessionError:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={
                "code": "authentication_required",
                "message": "로그인이 필요해요.",
            },
        )
    return PurchaseRequestOut.model_validate(created, from_attributes=True)


@requests_router.get("", response_model=list[PurchaseRequestOut])
def list_purchase_requests() -> list[PurchaseRequestOut]:
    return [
        PurchaseRequestOut.model_validate(request, from_attributes=True)
        for request in _requests_service.list()
    ]


@requests_router.get(
    "/{request_id}",
    response_model=PurchaseRequestOut,
    responses={status.HTTP_404_NOT_FOUND: {"model": ApiError}},
)
def get_purchase_request(request_id: str) -> PurchaseRequestOut | JSONResponse:
    try:
        parsed_id = UUID(request_id)
    except ValueError:
        return _not_found_response()

    request = _requests_service.get(parsed_id)
    if request is None:
        return _not_found_response()
    return PurchaseRequestOut.model_validate(request, from_attributes=True)
