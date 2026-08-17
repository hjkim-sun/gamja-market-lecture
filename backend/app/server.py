"""Supported local Uvicorn entry point with safe process logging."""

from __future__ import annotations

import argparse

import uvicorn

from app.core.logging import configure_process_logging


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Gamja Market development API.")
    parser.add_argument("--reload", action="store_true", help="reload after Python source changes")
    parser.add_argument("--port", type=int, default=8000, help="local TCP port (default: 8000)")
    return parser.parse_args()


def main() -> None:
    """Configure Uvicorn before it can bind a socket, then start the server."""
    args = _parse_args()
    if not 1 <= args.port <= 65535:
        raise SystemExit("--port must be between 1 and 65535")

    log_config = configure_process_logging()
    # This eager application creates the fixed local files before Uvicorn's
    # Config/bind lifecycle.  Uvicorn applies the same dict in reload children.
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=args.port,
        reload=args.reload,
        access_log=False,
        log_config=log_config,
    )


if __name__ == "__main__":
    main()
