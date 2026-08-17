import asyncio
import os
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.repositories.applications import PostgresApplicationRepository
from app.repositories.chats import PostgresChatRepository


def valid_payload() -> dict[str, object]:
    return {
        "title": "아이폰 14 프로 128GB 자급제",
        "category": "디지털기기",
        "desiredPrice": 750000,
        "description": "상태 좋은 자급제 아이폰을 찾고 있습니다.",
    }


async def request(method: str, path: str, **kwargs: object):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


async def authenticated_client() -> AsyncClient:
    """Return a client holding a genuine application session cookie."""
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    credentials = {
        "email": f"requester-{uuid4().hex}@example.com",
        "password": "password123",
        "password_confirmation": "password123",
        "display_name": f"요청-{uuid4().hex}",
    }
    signup_response = await client.post("/api/auth/signup", json=credentials)
    assert signup_response.status_code == 201
    login_response = await client.post(
        "/api/auth/login",
        json={"email": credentials["email"], "password": credentials["password"]},
    )
    assert login_response.status_code == 200
    return client


def test_list_returns_an_empty_array_before_any_purchase_request_exists() -> None:
    response = asyncio.run(request("GET", "/api/requests"))

    assert response.status_code == 200
    assert response.json() == []


def test_authenticated_user_can_create_request_and_server_ignores_client_owned_fields() -> None:
    async def create() -> tuple[int, dict[str, object], list[dict[str, object]]]:
        client = await authenticated_client()
        try:
            payload = valid_payload() | {
                "status": "마감",
                "requesterId": str(uuid4()),
            }
            response = await client.post("/api/requests", json=payload)
            listed = await client.get("/api/requests")
            assert listed.status_code == 200
            return response.status_code, response.json(), listed.json()
        finally:
            await client.aclose()

    status_code, created, listed = asyncio.run(create())

    assert status_code == 201
    assert created["id"]
    assert created["title"] == valid_payload()["title"]
    assert created["category"] == valid_payload()["category"]
    assert created["desiredPrice"] == valid_payload()["desiredPrice"]
    assert created["description"] == valid_payload()["description"]
    assert created["status"] == "모집중"
    assert "requesterId" not in created
    assert "requester_id" not in created
    assert listed[0]["id"] == created["id"]


def test_create_rejects_each_invalid_field_without_creating_a_request() -> None:
    async def create_invalid_requests() -> tuple[list[object], list[object]]:
        client = await authenticated_client()
        try:
            before = (await client.get("/api/requests")).json()
            responses = []
            for invalid_payload in (
                valid_payload() | {"title": " 한 "},
                valid_payload() | {"category": "의류"},
                valid_payload() | {"desiredPrice": 0},
                valid_payload() | {"desiredPrice": 100000001},
                valid_payload() | {"description": "너무 짧음"},
            ):
                responses.append(await client.post("/api/requests", json=invalid_payload))
            after = (await client.get("/api/requests")).json()
            return responses, [before, after]
        finally:
            await client.aclose()

    responses, lists = asyncio.run(create_invalid_requests())

    for response in responses:
        assert response.status_code == 400
        assert response.json()["code"] == "invalid_input"
        assert isinstance(response.json()["message"], str)
    assert lists[1] == lists[0]


def test_create_requires_an_active_session_and_does_not_create_a_request() -> None:
    async def attempt_unauthorized_creates() -> tuple[object, object, list[object], list[object]]:
        before = (await request("GET", "/api/requests")).json()
        without_cookie = await request("POST", "/api/requests", json=valid_payload())

        client = await authenticated_client()
        try:
            logout = await client.post("/api/auth/logout")
            assert logout.status_code == 204
            revoked_cookie = await client.post("/api/requests", json=valid_payload())
        finally:
            await client.aclose()

        after = (await request("GET", "/api/requests")).json()
        return without_cookie, revoked_cookie, before, after

    without_cookie, revoked_cookie, before, after = asyncio.run(attempt_unauthorized_creates())

    for response in (without_cookie, revoked_cookie):
        assert response.status_code == 401
        assert response.json() == {
            "code": "authentication_required",
            "message": "로그인이 필요해요.",
        }
    assert after == before


def test_mine_requires_a_valid_session() -> None:
    async def get_without_and_with_revoked_session() -> tuple[object, object]:
        without_session = await request("GET", "/api/requests/mine")

        client = await authenticated_client()
        try:
            logout = await client.post("/api/auth/logout")
            assert logout.status_code == 204
            with_revoked_session = await client.get("/api/requests/mine")
            return without_session, with_revoked_session
        finally:
            await client.aclose()

    without_session, with_revoked_session = asyncio.run(get_without_and_with_revoked_session())

    for response in (without_session, with_revoked_session):
        assert response.status_code == 401
        assert response.json() == {
            "code": "authentication_required",
            "message": "로그인이 필요해요.",
        }


def test_mine_returns_only_the_signed_in_users_requests_newest_first() -> None:
    async def create_and_list_mine() -> tuple[list[dict[str, object]], dict[str, object], dict[str, object], dict[str, object]]:
        owner = await authenticated_client()
        other_user = await authenticated_client()
        try:
            oldest = await owner.post(
                "/api/requests",
                json=valid_payload() | {"title": "첫 번째 내 구매요청"},
            )
            assert oldest.status_code == 201

            other_request = await other_user.post(
                "/api/requests",
                json=valid_payload() | {"title": "다른 사용자의 구매요청"},
            )
            assert other_request.status_code == 201

            newest = await owner.post(
                "/api/requests",
                json=valid_payload() | {"title": "가장 최근 내 구매요청"},
            )
            assert newest.status_code == 201

            response = await owner.get("/api/requests/mine")
            assert response.status_code == 200
            return response.json(), oldest.json(), newest.json(), other_request.json()
        finally:
            await owner.aclose()
            await other_user.aclose()

    mine, oldest, newest, other_request = asyncio.run(create_and_list_mine())

    assert [request["id"] for request in mine] == [newest["id"], oldest["id"]]
    assert other_request["id"] not in [request["id"] for request in mine]


def test_get_unknown_or_malformed_request_detail_returns_not_found_contract() -> None:
    async def get_unknown_details():
        unknown = await request("GET", f"/api/requests/{uuid4()}")
        malformed = await request("GET", "/api/requests/not-a-uuid")
        return unknown, malformed

    unknown, malformed = asyncio.run(get_unknown_details())

    for response in (unknown, malformed):
        assert response.status_code == 404
        assert response.json() == {
            "code": "not_found",
            "message": "구매요청을 찾을 수 없어요.",
        }


def test_request_detail_identifies_only_the_authenticated_owner() -> None:
    async def get_detail_as_each_viewer() -> tuple[object, object, object]:
        owner = await authenticated_client()
        other_user = await authenticated_client()
        try:
            created = await owner.post("/api/requests", json=valid_payload())
            assert created.status_code == 201
            request_id = created.json()["id"]

            owner_detail = await owner.get(f"/api/requests/{request_id}")
            anonymous_detail = await request("GET", f"/api/requests/{request_id}")
            other_user_detail = await other_user.get(f"/api/requests/{request_id}")
            return owner_detail, anonymous_detail, other_user_detail
        finally:
            await owner.aclose()
            await other_user.aclose()

    owner_detail, anonymous_detail, other_user_detail = asyncio.run(get_detail_as_each_viewer())

    assert owner_detail.status_code == 200
    assert owner_detail.json()["isOwner"] is True
    assert anonymous_detail.status_code == 200
    assert anonymous_detail.json()["isOwner"] is False
    assert other_user_detail.status_code == 200
    assert other_user_detail.json()["isOwner"] is False


@pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="requires the configured PostgreSQL database")
def test_postgres_request_detail_support_queries_are_available() -> None:
    """The authenticated detail path depends on both support-table lookups."""
    database_url = os.environ["DATABASE_URL"]
    request_id = uuid4()
    viewer_id = uuid4()

    application = PostgresApplicationRepository(database_url).get_by_request_and_seller(
        request_id=request_id,
        seller_id=viewer_id,
    )
    thread = PostgresChatRepository(database_url).get_by_application(uuid4())

    assert application is None
    assert thread is None
