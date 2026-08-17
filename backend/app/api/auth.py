"""HTTP endpoints for application-owned accounts and browser sessions."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Response, status
from fastapi.responses import JSONResponse

from app.core.config import read_auth_settings
from app.repositories.sessions import create_session_repository
from app.repositories.users import (
    DisplayNameAlreadyExistsError,
    EmailAlreadyExistsError,
    create_user_repository,
)
from app.schemas.auth import ApiError, LoginRequest, PublicUser, SignupRequest
from app.services.auth import AuthService, InvalidCredentialsError, InvalidSessionError


auth_router = APIRouter(prefix="/auth", tags=["auth"])
_auth_settings = read_auth_settings()
_auth_service = AuthService(
    create_user_repository(),
    create_session_repository(),
    session_ttl=_auth_settings.session_ttl,
)


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
    except DisplayNameAlreadyExistsError:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "code": "display_name_already_exists",
                "message": "이미 사용 중인 표시 이름이에요.",
            },
        )

    return PublicUser(id=user.id, email=user.email, display_name=user.display_name)


@auth_router.post(
    "/login",
    response_model=PublicUser,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": ApiError},
        status.HTTP_401_UNAUTHORIZED: {"model": ApiError},
    },
)
def login(request: LoginRequest, response: Response) -> PublicUser:
    try:
        result = _auth_service.login(request)
    except InvalidCredentialsError:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={
                "code": "invalid_credentials",
                "message": "이메일 또는 비밀번호가 올바르지 않아요.",
            },
        )

    response.set_cookie(
        key=_auth_settings.cookie_name,
        value=result.session_token,
        max_age=_auth_settings.session_ttl_seconds,
        path="/",
        secure=_auth_settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return PublicUser(
        id=result.user.id,
        email=result.user.email,
        display_name=result.user.display_name,
    )


@auth_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    gm_session: str | None = Cookie(default=None),
) -> None:
    _auth_service.logout(gm_session)
    response.delete_cookie(
        key=_auth_settings.cookie_name,
        path="/",
        secure=_auth_settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


@auth_router.get(
    "/me",
    response_model=PublicUser,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": ApiError}},
)
def me(gm_session: str | None = Cookie(default=None)) -> PublicUser:
    try:
        user = _auth_service.me(gm_session)
    except InvalidSessionError:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={
                "code": "invalid_session",
                "message": "로그인이 필요해요.",
            },
        )
    return PublicUser(id=user.id, email=user.email, display_name=user.display_name)
