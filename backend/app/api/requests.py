"""Public read and authenticated creation endpoints for purchase requests."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Cookie, File, UploadFile, status
from fastapi.responses import JSONResponse

from app.api.auth import _auth_service
from app.api.dependencies import applications_service, requests_service
from app.core.images import InvalidImageError
from app.repositories.applications import AlreadyAppliedError, RequestNotOpenError
from app.repositories.request_images import ImageLimitExceededError, RequestImage
from app.schemas.requests import (
    ApiError,
    CreateRequestInput,
    MyPurchaseRequestOut,
    PurchaseRequestDetailOut,
    PurchaseRequestOut,
    RequestImageOut,
    RequestImageUploadOut,
)
from app.schemas.applications import ApplicationImageOut, ApplicationOut, CreateApplicationInput, OwnerApplicationOut
from app.services.applications import CannotApplyToOwnRequestError, NotRequestOwnerError
from app.services.requests import NotRequestOwnerError as NotPurchaseRequestOwnerError
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
    requests = _requests_service.list()
    images_by_request = _requests_service.images_for_requests([request.id for request in requests])
    return [
        _purchase_request_out(request, images_by_request.get(request.id, []))
        for request in requests
    ]


@requests_router.get(
    "/mine",
    response_model=list[MyPurchaseRequestOut],
    responses={status.HTTP_401_UNAUTHORIZED: {"model": ApiError}},
)
def list_my_purchase_requests(
    gm_session: str | None = Cookie(default=None),
) -> list[MyPurchaseRequestOut] | JSONResponse:
    try:
        rows = _requests_service.list_mine(gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    images_by_request = _requests_service.images_for_requests([request.id for request, _ in rows])
    return [
        MyPurchaseRequestOut(
            **_purchase_request_out(request, images_by_request.get(request.id, [])).model_dump(),
            application_count=count,
        )
        for request, count in rows
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
    images = _requests_service.images_for_requests([request.id]).get(request.id, [])
    public_request = _purchase_request_out(request, images)
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


@requests_router.post(
    "/{request_id}/images",
    response_model=RequestImageUploadOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": ApiError},
        status.HTTP_401_UNAUTHORIZED: {"model": ApiError},
        status.HTTP_403_FORBIDDEN: {"model": ApiError},
        status.HTTP_404_NOT_FOUND: {"model": ApiError},
        status.HTTP_409_CONFLICT: {"model": ApiError},
    },
)
def attach_request_images(
    request_id: str,
    images: list[UploadFile] = File(default=[]),
    gm_session: str | None = Cookie(default=None),
) -> RequestImageUploadOut | JSONResponse:
    try:
        parsed_id = UUID(request_id)
    except ValueError:
        return _not_found_response()
    try:
        created = _requests_service.attach_images(request_id=parsed_id, uploads=images, session_token=gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    except LookupError:
        return _not_found_response()
    except NotPurchaseRequestOwnerError:
        return _error_response(status.HTTP_403_FORBIDDEN, "not_request_owner", "요청 작성자만 사진을 추가할 수 있어요.")
    except ValueError:
        return _error_response(status.HTTP_400_BAD_REQUEST, "no_files", "사진을 하나 이상 선택해주세요.")
    except ImageLimitExceededError:
        return _error_response(status.HTTP_409_CONFLICT, "image_limit_exceeded", "사진은 최대 5장까지 추가할 수 있어요.")
    except InvalidImageError:
        return _error_response(status.HTTP_400_BAD_REQUEST, "invalid_image", "이미지 파일을 확인해주세요.")
    return RequestImageUploadOut(images=[_request_image_out(image) for image in created])


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
    images_by_application = applications_service.images_for_applications([application.id for application, _ in applications])
    return [
        OwnerApplicationOut(
            id=application.id,
            seller_display_name=seller_name,
            offered_price=application.offered_price,
            message=application.message,
            status=application.status,
            created_at=application.created_at,
            images=[_application_image_out(image) for image in images_by_application.get(application.id, [])],
        )
        for application, seller_name in applications
    ]


def _authentication_required_response() -> JSONResponse:
    return _error_response(status.HTTP_401_UNAUTHORIZED, "authentication_required", "로그인이 필요해요.")


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code, "message": message})


def _request_image_out(image: RequestImage) -> RequestImageOut:
    return RequestImageOut(id=image.id, url=_requests_service.public_image_url(image), sort_order=image.sort_order)


def _purchase_request_out(request: object, images: list[RequestImage]) -> PurchaseRequestOut:
    return PurchaseRequestOut(
        **PurchaseRequestOut.model_validate(request, from_attributes=True).model_dump(exclude={"images"}),
        images=[_request_image_out(image) for image in images],
    )


def _application_image_out(image: object) -> ApplicationImageOut:
    return ApplicationImageOut(
        id=image.id,
        url=applications_service.signed_image_url(image),
        sort_order=image.sort_order,
    )
