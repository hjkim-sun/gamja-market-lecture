from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse

from app.api.router import api_router
from app.core.logging import RequestTimer, RuntimeLogger, configure_runtime_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize logging only while a real ASGI lifespan is active."""
    app.state.runtime_logger = configure_runtime_logging()
    try:
        yield
    finally:
        app.state.runtime_logger.close()


app = FastAPI(title="Gamja Market API", version="0.1.0", lifespan=lifespan)
app.include_router(api_router, prefix="/api")


@app.middleware("http")
async def log_http_request(request: Request, call_next) -> Response:
    """Return a generated request ID and log only safe, body-free access metadata."""
    request_id = str(uuid4())
    timer = RequestTimer()
    logger: RuntimeLogger | None = getattr(request.app.state, "runtime_logger", None)
    method = request.method

    try:
        response = await call_next(request)
    except Exception as error:
        if logger is not None:
            route = request.url.path
            logger.event(
                "http_error",
                "unhandled server error",
                level="ERROR",
                request_id=request_id,
                method=method,
                route=route,
                status_code=500,
                duration_ms=timer.duration_ms,
                error_type=type(error).__name__,
                error_code="unhandled_exception",
            )
            logger.event(
                "http_request",
                "request completed",
                request_id=request_id,
                method=method,
                route=route,
                status_code=500,
                duration_ms=timer.duration_ms,
            )
        # Keep the correlation header on deliberate 500 responses as well.
        # The log entry above deliberately contains no exception text.
        response = PlainTextResponse("Internal Server Error", status_code=500)
        response.headers["X-Request-ID"] = request_id
        return response

    response.headers["X-Request-ID"] = request_id
    if logger is not None:
        route = request.url.path
        logger.event(
            "http_request",
            "request completed",
            request_id=request_id,
            method=method,
            route=route,
            status_code=response.status_code,
            duration_ms=timer.duration_ms,
        )
    return response


@app.exception_handler(RequestValidationError)
async def invalid_input_handler(_: Request, __: RequestValidationError) -> JSONResponse:
    """Keep malformed auth payloads on the documented 400 error contract."""
    return JSONResponse(
        status_code=400,
        content={
            "code": "invalid_input",
            "message": "입력값을 확인해주세요.",
        },
    )
