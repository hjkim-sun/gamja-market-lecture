"""Public read and authenticated creation endpoints for purchase requests."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Cookie, status
from fastapi.responses import JSONResponse

from app.api.auth import _auth_service
from app.api.dependencies import applications_service, requests_service
from app.repositories.applications import AlreadyAppliedError, RequestNotOpenError
from app.schemas.requests import (
    ApiError,
    CreateRequestInput,
    PurchaseRequestDetailOut,
    PurchaseRequestOut,
)
from app.schemas.applications import ApplicationOut, CreateApplicationInput, OwnerApplicationOut
from app.services.applications import CannotApplyToOwnRequestError, NotRequestOwnerError
from app.services.auth import InvalidSessionError


requests_router = APIRouter(prefix="/requests", tags=["requests"])
_requests_service = requests_service


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
    response_model=PurchaseRequestDetailOut,
    responses={status.HTTP_404_NOT_FOUND: {"model": ApiError}},
)
def get_purchase_request(
    request_id: str,
    gm_session: str | None = Cookie(default=None),
) -> PurchaseRequestDetailOut | JSONResponse:
    try:
        parsed_id = UUID(request_id)
    except ValueError:
        return _not_found_response()

    request = _requests_service.get(parsed_id)
    if request is None:
        return _not_found_response()

    try:
        viewer = _auth_service.me(gm_session)
    except InvalidSessionError:
        is_owner = False
    else:
        is_owner = viewer.id == request.requester_id

    application, thread = applications_service.viewer_application(request_id=parsed_id, session_token=gm_session)
    public_request = PurchaseRequestOut.model_validate(request, from_attributes=True)
    return PurchaseRequestDetailOut(
        **public_request.model_dump(),
        is_owner=is_owner,
        viewer_application_status=application.status if application else None,
        viewer_chat_thread_id=thread.id if thread else None,
    )


@requests_router.post(
    "/{request_id}/applications",
    response_model=ApplicationOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": ApiError},
        status.HTTP_401_UNAUTHORIZED: {"model": ApiError},
        status.HTTP_403_FORBIDDEN: {"model": ApiError},
        status.HTTP_404_NOT_FOUND: {"model": ApiError},
        status.HTTP_409_CONFLICT: {"model": ApiError},
    },
)
def create_application(
    request_id: str,
    payload: CreateApplicationInput,
    gm_session: str | None = Cookie(default=None),
) -> ApplicationOut | JSONResponse:
    try:
        parsed_id = UUID(request_id)
    except ValueError:
        return _not_found_response()
    try:
        application = applications_service.create(request_id=parsed_id, payload=payload, session_token=gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    except LookupError:
        return _not_found_response()
    except CannotApplyToOwnRequestError:
        return _error_response(status.HTTP_403_FORBIDDEN, "cannot_apply_to_own_request", "내 요청에는 지원할 수 없어요.")
    except RequestNotOpenError:
        return _error_response(status.HTTP_409_CONFLICT, "request_not_open", "모집 중인 요청에만 지원할 수 있어요.")
    except AlreadyAppliedError:
        return _error_response(status.HTTP_409_CONFLICT, "already_applied", "이미 지원한 요청이에요.")
    return ApplicationOut.model_validate(application, from_attributes=True)


@requests_router.get(
    "/{request_id}/applications",
    response_model=list[OwnerApplicationOut],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ApiError},
        status.HTTP_403_FORBIDDEN: {"model": ApiError},
        status.HTTP_404_NOT_FOUND: {"model": ApiError},
    },
)
def list_request_applications(
    request_id: str,
    gm_session: str | None = Cookie(default=None),
) -> list[OwnerApplicationOut] | JSONResponse:
    try:
        parsed_id = UUID(request_id)
    except ValueError:
        return _not_found_response()
    try:
        applications = applications_service.list_for_request(request_id=parsed_id, session_token=gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    except LookupError:
        return _not_found_response()
    except NotRequestOwnerError:
        return _error_response(status.HTTP_403_FORBIDDEN, "not_request_owner", "요청 작성자만 지원자를 볼 수 있어요.")
    return [
        OwnerApplicationOut(
            id=application.id,
            seller_display_name=seller_name,
            offered_price=application.offered_price,
            message=application.message,
            status=application.status,
            created_at=application.created_at,
        )
        for application, seller_name in applications
    ]


def _authentication_required_response() -> JSONResponse:
    return _error_response(status.HTTP_401_UNAUTHORIZED, "authentication_required", "로그인이 필요해요.")


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code, "message": message})
