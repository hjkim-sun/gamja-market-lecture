import asyncio
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from app.main import app


REQUEST_PAYLOAD = {
    "title": "아이폰 14 프로 128GB 자급제",
    "category": "디지털기기",
    "desiredPrice": 750000,
    "description": "상태 좋은 자급제 아이폰을 찾고 있습니다.",
}
APPLICATION_PAYLOAD = {
    "offeredPrice": 700000,
    "message": "동일 모델 재고 있습니다. 오늘 바로 거래 가능해요.",
}


async def authenticated_client(label: str) -> AsyncClient:
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    credentials = {
        "email": f"{label}-{uuid4().hex}@example.com",
        "password": "password123",
        "password_confirmation": "password123",
        "display_name": f"{label}-{uuid4().hex[:30]}",
    }
    assert (await client.post("/api/auth/signup", json=credentials)).status_code == 201
    assert (await client.post("/api/auth/login", json={"email": credentials["email"], "password": credentials["password"]})).status_code == 200
    return client


def test_applications_enforce_open_owner_and_duplicate_guards() -> None:
    async def scenario():
        buyer, seller, stranger = await authenticated_client("buyer"), await authenticated_client("seller"), await authenticated_client("stranger")
        try:
            created = await buyer.post("/api/requests", json=REQUEST_PAYLOAD)
            request_id = created.json()["id"]
            own = await buyer.post(f"/api/requests/{request_id}/applications", json=APPLICATION_PAYLOAD)
            application = await seller.post(f"/api/requests/{request_id}/applications", json=APPLICATION_PAYLOAD)
            duplicate = await seller.post(f"/api/requests/{request_id}/applications", json=APPLICATION_PAYLOAD)
            non_owner_list = await stranger.get(f"/api/requests/{request_id}/applications")
            owner_list = await buyer.get(f"/api/requests/{request_id}/applications")
            mine = await seller.get("/api/applications/mine")
            return own, application, duplicate, non_owner_list, owner_list, mine
        finally:
            await buyer.aclose(); await seller.aclose(); await stranger.aclose()

    own, application, duplicate, non_owner_list, owner_list, mine = asyncio.run(scenario())
    assert own.status_code == 403 and own.json()["code"] == "cannot_apply_to_own_request"
    assert application.status_code == 201
    assert application.json()["status"] == "대기중"
    assert "sellerId" not in application.json()
    assert duplicate.status_code == 409 and duplicate.json()["code"] == "already_applied"
    assert non_owner_list.status_code == 403 and non_owner_list.json()["code"] == "not_request_owner"
    assert owner_list.status_code == 200 and owner_list.json()[0]["offeredPrice"] == 700000
    assert mine.status_code == 200 and mine.json()[0]["requestTitle"] == REQUEST_PAYLOAD["title"]


def test_accept_creates_chat_rejects_other_pending_and_limits_chat_to_participants() -> None:
    async def scenario():
        buyer, seller, other_seller, stranger = (await authenticated_client("buyer"), await authenticated_client("seller"), await authenticated_client("other"), await authenticated_client("stranger"))
        try:
            request_id = (await buyer.post("/api/requests", json=REQUEST_PAYLOAD)).json()["id"]
            first = await seller.post(f"/api/requests/{request_id}/applications", json=APPLICATION_PAYLOAD)
            second = await other_seller.post(f"/api/requests/{request_id}/applications", json=APPLICATION_PAYLOAD | {"message": "다른 판매 제안입니다. 즉시 거래 가능합니다."})
            accepted = await buyer.patch(f"/api/applications/{first.json()['id']}", json={"decision": "accept"})
            chat_id = accepted.json()["chatThreadId"]
            second_status = await other_seller.get("/api/applications/mine")
            buyer_detail = await buyer.get(f"/api/chats/{chat_id}")
            stranger_detail = await stranger.get(f"/api/chats/{chat_id}")
            sent = await seller.post(f"/api/chats/{chat_id}/messages", json={"body": "네, 오늘 오후 가능합니다."})
            seller_chats = await seller.get("/api/chats")
            buyer_chats = await buyer.get("/api/chats")
            request_detail = await seller.get(f"/api/requests/{request_id}")
            return accepted, second, second_status, buyer_detail, stranger_detail, sent, seller_chats, buyer_chats, request_detail
        finally:
            await buyer.aclose(); await seller.aclose(); await other_seller.aclose(); await stranger.aclose()

    accepted, second, second_status, buyer_detail, stranger_detail, sent, seller_chats, buyer_chats, request_detail = asyncio.run(scenario())
    assert accepted.status_code == 200
    assert accepted.json()["application"]["status"] == "수락됨"
    assert accepted.json()["chatThreadId"]
    assert second.status_code == 201
    assert second_status.json()[0]["status"] == "거절됨"
    assert buyer_detail.status_code == 200 and buyer_detail.json()["messages"] == []
    assert stranger_detail.status_code == 403 and stranger_detail.json()["code"] == "not_chat_participant"
    assert sent.status_code == 201 and sent.json()["body"] == "네, 오늘 오후 가능합니다."
    assert seller_chats.json()[0]["viewerRole"] == "seller"
    assert buyer_chats.json()[0]["viewerRole"] == "buyer"
    assert request_detail.json()["status"] == "협의중"
    assert request_detail.json()["viewerApplicationStatus"] == "수락됨"
    assert request_detail.json()["viewerChatThreadId"] == accepted.json()["chatThreadId"]
