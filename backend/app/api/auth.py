"""HTTP endpoints for application-owned account creation."""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.repositories.users import EmailAlreadyExistsError, create_user_repository
from app.schemas.auth import ApiError, PublicUser, SignupRequest
from app.services.auth import AuthService


auth_router = APIRouter(prefix="/auth", tags=["auth"])
_auth_service = AuthService(create_user_repository())


@auth_router.post(
    "/signup",
    response_model=PublicUser,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": ApiError},
        status.HTTP_409_CONFLICT: {"model": ApiError},
    },
)
def signup(request: SignupRequest) -> PublicUser:
    try:
        user = _auth_service.signup(request)
    except EmailAlreadyExistsError:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "code": "email_already_exists",
                "message": "이미 사용 중인 이메일이에요.",
            },
        )

    return PublicUser(id=user.id, email=user.email)
