import asyncio
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from app.main import app


def request_payload() -> dict[str, object]:
    return {
        "title": "아이폰 14 프로 128GB 자급제",
        "category": "디지털기기",
        "desiredPrice": 750000,
        "description": "상태 좋은 자급제 아이폰을 찾고 있습니다.",
    }


def application_payload() -> dict[str, object]:
    return {
        "offeredPrice": 700000,
        "message": "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.",
    }


async def authenticated_client(label: str) -> AsyncClient:
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    credentials = {
        "email": f"{label}-{uuid4().hex}@example.com",
        "password": "password123",
        "password_confirmation": "password123",
        "display_name": f"{label[:8]}-{uuid4().hex[:12]}",
    }
    signup = await client.post("/api/auth/signup", json=credentials)
    assert signup.status_code == 201
    login = await client.post(
        "/api/auth/login",
        json={"email": credentials["email"], "password": credentials["password"]},
    )
    assert login.status_code == 200
    return client


async def create_open_request(owner: AsyncClient) -> str:
    response = await owner.post("/api/requests", json=request_payload())
    assert response.status_code == 201
    return response.json()["id"]


def test_distinct_sellers_can_apply_once_each_and_owner_sees_descending_application_list() -> None:
    async def scenario() -> tuple[object, object, object]:
        owner = await authenticated_client("application-owner")
        first_seller = await authenticated_client("application-first-seller")
        second_seller = await authenticated_client("application-second-seller")
        try:
            request_id = await create_open_request(owner)
            first = await first_seller.post(
                f"/api/requests/{request_id}/applications", json=application_payload()
            )
            second = await second_seller.post(
                f"/api/requests/{request_id}/applications",
                json=application_payload() | {"offeredPrice": 710000},
            )
            listed = await owner.get(f"/api/requests/{request_id}/applications")
            return first, second, listed
        finally:
            await owner.aclose()
            await first_seller.aclose()
            await second_seller.aclose()

    first, second, listed = asyncio.run(scenario())

    for response in (first, second):
        assert response.status_code == 201
        assert response.json()["id"]
        assert response.json()["status"] == "대기중"
        assert response.json()["requestId"]
        assert response.json()["offeredPrice"] in {700000, 710000}
        assert "sellerId" not in response.json()
    assert listed.status_code == 200
    assert [entry["offeredPrice"] for entry in listed.json()] == [710000, 700000]
    assert all("sellerDisplayName" in entry for entry in listed.json())
    assert all("sellerId" not in entry for entry in listed.json())


def test_same_seller_cannot_apply_twice_and_duplicate_does_not_create_another_row() -> None:
    async def scenario() -> tuple[object, object, object]:
        owner = await authenticated_client("duplicate-owner")
        seller = await authenticated_client("duplicate-seller")
        try:
            request_id = await create_open_request(owner)
            created = await seller.post(
                f"/api/requests/{request_id}/applications", json=application_payload()
            )
            duplicate = await seller.post(
                f"/api/requests/{request_id}/applications", json=application_payload()
            )
            listed = await owner.get(f"/api/requests/{request_id}/applications")
            return created, duplicate, listed
        finally:
            await owner.aclose()
            await seller.aclose()

    created, duplicate, listed = asyncio.run(scenario())

    assert created.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "already_applied"
    assert listed.status_code == 200
    assert [entry["id"] for entry in listed.json()] == [created.json()["id"]]


def test_application_creation_enforces_authorship_authentication_and_input_contract() -> None:
    async def scenario() -> tuple[object, object, list[object], object]:
        owner = await authenticated_client("guard-owner")
        seller = await authenticated_client("guard-seller")
        try:
            request_id = await create_open_request(owner)
            anonymous = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
            try:
                unauthenticated = await anonymous.post(
                    f"/api/requests/{request_id}/applications", json=application_payload()
                )
            finally:
                await anonymous.aclose()
            self_application = await owner.post(
                f"/api/requests/{request_id}/applications", json=application_payload()
            )
            invalid_responses = []
            for payload in (
                application_payload() | {"offeredPrice": 0},
                application_payload() | {"offeredPrice": 100000001},
                application_payload() | {"message": "짧아요"},
                application_payload() | {"message": "가" * 501},
            ):
                invalid_responses.append(
                    await seller.post(f"/api/requests/{request_id}/applications", json=payload)
                )
            listed = await owner.get(f"/api/requests/{request_id}/applications")
            return unauthenticated, self_application, invalid_responses, listed
        finally:
            await owner.aclose()
            await seller.aclose()

    unauthenticated, self_application, invalid_responses, listed = asyncio.run(scenario())

    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["code"] == "authentication_required"
    assert self_application.status_code == 403
    assert self_application.json()["code"] == "cannot_apply_to_own_request"
    for response in invalid_responses:
        assert response.status_code == 400
        assert response.json()["code"] == "invalid_input"
    assert listed.status_code == 200
    assert listed.json() == []


def test_application_list_is_visible_only_to_the_request_owner() -> None:
    async def scenario() -> tuple[object, object, object]:
        owner = await authenticated_client("list-owner")
        seller = await authenticated_client("list-seller")
        outsider = await authenticated_client("list-outsider")
        try:
            request_id = await create_open_request(owner)
            created = await seller.post(
                f"/api/requests/{request_id}/applications", json=application_payload()
            )
            assert created.status_code == 201
            outsider_list = await outsider.get(f"/api/requests/{request_id}/applications")
            anonymous = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
            try:
                anonymous_list = await anonymous.get(f"/api/requests/{request_id}/applications")
            finally:
                await anonymous.aclose()
            owner_list = await owner.get(f"/api/requests/{request_id}/applications")
            return outsider_list, anonymous_list, owner_list
        finally:
            await owner.aclose()
            await seller.aclose()
            await outsider.aclose()

    outsider_list, anonymous_list, owner_list = asyncio.run(scenario())

    assert outsider_list.status_code == 403
    assert outsider_list.json()["code"] == "not_request_owner"
    assert anonymous_list.status_code == 401
    assert anonymous_list.json()["code"] == "authentication_required"
    assert owner_list.status_code == 200
    assert len(owner_list.json()) == 1


def test_owner_acceptance_rejects_other_pending_applications_updates_request_and_creates_chat() -> None:
    async def scenario() -> tuple[object, object, object, object]:
        owner = await authenticated_client("accept-owner")
        accepted_seller = await authenticated_client("accepted-seller")
        rejected_seller = await authenticated_client("rejected-seller")
        try:
            request_id = await create_open_request(owner)
            accepted = await accepted_seller.post(
                f"/api/requests/{request_id}/applications", json=application_payload()
            )
            rejected = await rejected_seller.post(
                f"/api/requests/{request_id}/applications",
                json=application_payload() | {"offeredPrice": 720000},
            )
            assert accepted.status_code == 201
            assert rejected.status_code == 201
            decision = await owner.patch(
                f"/api/applications/{accepted.json()['id']}", json={"decision": "accept"}
            )
            applications = await owner.get(f"/api/requests/{request_id}/applications")
            detail = await owner.get(f"/api/requests/{request_id}")
            chats = await accepted_seller.get("/api/chats")
            return decision, applications, detail, chats
        finally:
            await owner.aclose()
            await accepted_seller.aclose()
            await rejected_seller.aclose()

    decision, applications, detail, chats = asyncio.run(scenario())

    assert decision.status_code == 200
    assert decision.json()["application"]["status"] == "수락됨"
    assert decision.json()["chatThreadId"]
    assert {entry["status"] for entry in applications.json()} == {"수락됨", "거절됨"}
    assert detail.json()["status"] == "협의중"
    assert chats.status_code == 200
    assert [thread["id"] for thread in chats.json()] == [decision.json()["chatThreadId"]]


def test_only_owner_can_decide_and_decided_applications_cannot_be_decided_again() -> None:
    async def scenario() -> tuple[object, object, object]:
        owner = await authenticated_client("decision-owner")
        seller = await authenticated_client("decision-seller")
        outsider = await authenticated_client("decision-outsider")
        try:
            request_id = await create_open_request(owner)
            application = await seller.post(
                f"/api/requests/{request_id}/applications", json=application_payload()
            )
            assert application.status_code == 201
            application_id = application.json()["id"]
            unauthorized = await outsider.patch(
                f"/api/applications/{application_id}", json={"decision": "reject"}
            )
            rejected = await owner.patch(
                f"/api/applications/{application_id}", json={"decision": "reject"}
            )
            repeated = await owner.patch(
                f"/api/applications/{application_id}", json={"decision": "accept"}
            )
            return unauthorized, rejected, repeated
        finally:
            await owner.aclose()
            await seller.aclose()
            await outsider.aclose()

    unauthorized, rejected, repeated = asyncio.run(scenario())

    assert unauthorized.status_code == 403
    assert unauthorized.json()["code"] == "not_request_owner"
    assert rejected.status_code == 200
    assert rejected.json()["application"]["status"] == "거절됨"
    assert repeated.status_code == 409
    assert repeated.json()["code"] == "application_already_decided"
