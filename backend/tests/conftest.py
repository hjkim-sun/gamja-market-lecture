"""Keep process-scoped in-memory API dependencies isolated between tests."""

import pytest

from app.api.auth import _session_repository, _user_repository
from app.api.dependencies import application_repository, chat_repository, request_repository


@pytest.fixture(autouse=True)
def reset_in_memory_repositories() -> None:
    repositories = (
        _session_repository,
        _user_repository,
        application_repository,
        chat_repository,
        request_repository,
    )
    for repository in repositories:
        clear = getattr(repository, "clear", None)
        if clear is not None:
            clear()
    yield
    for repository in repositories:
        clear = getattr(repository, "clear", None)
        if clear is not None:
            clear()
