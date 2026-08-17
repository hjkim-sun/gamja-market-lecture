from fastapi import APIRouter

from app.api.auth import auth_router
from app.api.requests import requests_router
from app.schemas.health import HealthResponse


api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(requests_router)


@api_router.get("/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    return HealthResponse(status="ok")
