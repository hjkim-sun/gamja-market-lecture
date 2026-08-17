"""Authenticated seller application list and decision endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Cookie, File, UploadFile, status
from fastapi.responses import JSONResponse

from app.api.dependencies import applications_service
from app.api.requests import _authentication_required_response, _error_response, _not_found_response
from app.core.images import InvalidImageError
from app.repositories.applications import ApplicationAlreadyDecidedError, RequestNotOpenError
from app.repositories.request_images import ImageLimitExceededError
from app.schemas.applications import ApplicationImageOut, ApplicationImageUploadOut, ApplicationOut, DecideApplicationInput, DecisionOut, MyApplicationOut
from app.schemas.requests import ApiError
from app.services.applications import AcceptedApplication, NotApplicationOwnerError, NotRequestOwnerError
from app.services.auth import InvalidSessionError


applications_router = APIRouter(prefix="/applications", tags=["applications"])


@applications_router.get("/mine", response_model=list[MyApplicationOut], responses={status.HTTP_401_UNAUTHORIZED: {"model": ApiError}})
def my_applications(gm_session: str | None = Cookie(default=None)) -> list[MyApplicationOut] | JSONResponse:
    try:
        applications = applications_service.mine(gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    images_by_application = applications_service.images_for_applications([application.id for application, _ in applications])
    return [
        MyApplicationOut(
            id=application.id,
            request_id=application.request_id,
            request_title=request.title,
            offered_price=application.offered_price,
            message=application.message,
            status=application.status,
            created_at=application.created_at,
            images=[_application_image_out(image) for image in images_by_application.get(application.id, [])],
        )
        for application, request in applications
    ]


@applications_router.post(
    "/{application_id}/images",
    response_model=ApplicationImageUploadOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": ApiError},
        status.HTTP_401_UNAUTHORIZED: {"model": ApiError},
        status.HTTP_403_FORBIDDEN: {"model": ApiError},
        status.HTTP_404_NOT_FOUND: {"model": ApiError},
        status.HTTP_409_CONFLICT: {"model": ApiError},
    },
)
def attach_application_images(
    application_id: str,
    images: list[UploadFile] = File(default=[]),
    gm_session: str | None = Cookie(default=None),
) -> ApplicationImageUploadOut | JSONResponse:
    try:
        parsed_id = UUID(application_id)
    except ValueError:
        return _not_found_response()
    try:
        created = applications_service.attach_images(application_id=parsed_id, uploads=images, session_token=gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    except LookupError:
        return _not_found_response()
    except NotApplicationOwnerError:
        return _error_response(status.HTTP_403_FORBIDDEN, "not_application_owner", "지원자 본인만 사진을 추가할 수 있어요.")
    except ValueError:
        return _error_response(status.HTTP_400_BAD_REQUEST, "no_files", "사진을 하나 이상 선택해주세요.")
    except ImageLimitExceededError:
        return _error_response(status.HTTP_409_CONFLICT, "image_limit_exceeded", "사진은 최대 5장까지 추가할 수 있어요.")
    except InvalidImageError:
        return _error_response(status.HTTP_400_BAD_REQUEST, "invalid_image", "이미지 파일을 확인해주세요.")
    return ApplicationImageUploadOut(images=[_application_image_out(image) for image in created])


@applications_router.patch(
    "/{application_id}",
    response_model=DecisionOut,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": ApiError},
        status.HTTP_401_UNAUTHORIZED: {"model": ApiError},
        status.HTTP_403_FORBIDDEN: {"model": ApiError},
        status.HTTP_404_NOT_FOUND: {"model": ApiError},
        status.HTTP_409_CONFLICT: {"model": ApiError},
    },
)
def decide_application(
    application_id: str,
    payload: DecideApplicationInput,
    gm_session: str | None = Cookie(default=None),
) -> DecisionOut | JSONResponse:
    try:
        parsed_id = UUID(application_id)
    except ValueError:
        return _not_found_response()
    try:
        result = applications_service.decide(application_id=parsed_id, decision=payload.decision, session_token=gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    except LookupError:
        return _not_found_response()
    except NotRequestOwnerError:
        return _error_response(status.HTTP_403_FORBIDDEN, "not_request_owner", "요청 작성자만 지원을 처리할 수 있어요.")
    except ApplicationAlreadyDecidedError:
        return _error_response(status.HTTP_409_CONFLICT, "application_already_decided", "이미 처리된 지원이에요.")
    except RequestNotOpenError:
        return _error_response(status.HTTP_409_CONFLICT, "request_not_open", "모집 중인 요청에만 수락할 수 있어요.")
    if isinstance(result, AcceptedApplication):
        application = ApplicationOut.model_validate(result.application, from_attributes=True)
        return DecisionOut(application=application, chat_thread_id=result.chat_thread_id)
    return DecisionOut(application=ApplicationOut.model_validate(result, from_attributes=True))


def _application_image_out(image: object) -> ApplicationImageOut:
    return ApplicationImageOut(
        id=image.id,
        url=applications_service.signed_image_url(image),
        sort_order=image.sort_order,
    )
