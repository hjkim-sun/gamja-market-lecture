import asyncio
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from app.main import app


def request_payload() -> dict[str, object]:
    return {
        "title": "닌텐도 스위치 OLED 화이트",
        "category": "게임/취미",
        "desiredPrice": 300000,
        "description": "상태 좋은 닌텐도 스위치 OLED 화이트를 찾고 있습니다.",
    }


def application_payload() -> dict[str, object]:
    return {
        "offeredPrice": 280000,
        "message": "구성품 모두 있고 깨끗하게 사용한 제품입니다.",
    }


async def authenticated_client(label: str) -> AsyncClient:
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    credentials = {
        "email": f"{label}-{uuid4().hex}@example.com",
        "password": "password123",
        "password_confirmation": "password123",
        "display_name": f"{label[:8]}-{uuid4().hex[:12]}",
    }
    assert (await client.post("/api/auth/signup", json=credentials)).status_code == 201
    assert (
        await client.post(
            "/api/auth/login",
            json={"email": credentials["email"], "password": credentials["password"]},
        )
    ).status_code == 200
    return client


async def create_matched_thread(
    buyer: AsyncClient, seller: AsyncClient
) -> tuple[str, str]:
    request = await buyer.post("/api/requests", json=request_payload())
    assert request.status_code == 201
    request_id = request.json()["id"]
    application = await seller.post(
        f"/api/requests/{request_id}/applications", json=application_payload()
    )
    assert application.status_code == 201
    accepted = await buyer.patch(
        f"/api/applications/{application.json()['id']}", json={"decision": "accept"}
    )
    assert accepted.status_code == 200
    return request_id, accepted.json()["chatThreadId"]


def test_chat_lists_show_only_participant_threads_and_viewer_role() -> None:
    async def scenario() -> tuple[object, object, object, str]:
        buyer = await authenticated_client("chat-list-buyer")
        seller = await authenticated_client("chat-list-seller")
        outsider = await authenticated_client("chat-list-outsider")
        try:
            request_id, thread_id = await create_matched_thread(buyer, seller)
            buyer_list = await buyer.get("/api/chats")
            seller_list = await seller.get("/api/chats")
            outsider_list = await outsider.get("/api/chats")
            return buyer_list, seller_list, outsider_list, request_id
        finally:
            await buyer.aclose()
            await seller.aclose()
            await outsider.aclose()

    buyer_list, seller_list, outsider_list, request_id = asyncio.run(scenario())

    assert buyer_list.status_code == 200
    assert seller_list.status_code == 200
    assert outsider_list.status_code == 200
    assert len(buyer_list.json()) == 1
    assert len(seller_list.json()) == 1
    assert outsider_list.json() == []
    assert buyer_list.json()[0]["requestId"] == request_id
    assert buyer_list.json()[0]["viewerRole"] == "buyer"
    assert seller_list.json()[0]["viewerRole"] == "seller"
    assert buyer_list.json()[0]["counterpartDisplayName"]
    assert buyer_list.json()[0]["lastMessageAt"]


def test_only_matched_buyer_and_seller_can_read_or_send_messages() -> None:
    async def scenario() -> tuple[object, object, object, object, object]:
        buyer = await authenticated_client("chat-access-buyer")
        seller = await authenticated_client("chat-access-seller")
        outsider = await authenticated_client("chat-access-outsider")
        try:
            _, thread_id = await create_matched_thread(buyer, seller)
            buyer_detail = await buyer.get(f"/api/chats/{thread_id}")
            seller_message = await seller.post(
                f"/api/chats/{thread_id}/messages", json={"body": " 네, 오늘 오후 가능하신가요? "}
            )
            buyer_after_message = await buyer.get(f"/api/chats/{thread_id}")
            outsider_detail = await outsider.get(f"/api/chats/{thread_id}")
            outsider_message = await outsider.post(
                f"/api/chats/{thread_id}/messages", json={"body": "저도 참여할게요"}
            )
            return buyer_detail, seller_message, buyer_after_message, outsider_detail, outsider_message
        finally:
            await buyer.aclose()
            await seller.aclose()
            await outsider.aclose()

    buyer_detail, seller_message, buyer_after_message, outsider_detail, outsider_message = asyncio.run(scenario())

    assert buyer_detail.status_code == 200
    assert buyer_detail.json()["viewerId"]
    assert buyer_detail.json()["messages"] == []
    assert seller_message.status_code == 201
    assert seller_message.json()["body"] == "네, 오늘 오후 가능하신가요?"
    assert seller_message.json()["senderId"]
    assert buyer_after_message.json()["messages"] == [seller_message.json()]
    for response in (outsider_detail, outsider_message):
        assert response.status_code == 403
        assert response.json()["code"] == "not_chat_participant"


def test_message_body_validation_and_unauthenticated_chat_contract_do_not_leak_data() -> None:
    async def scenario() -> tuple[list[object], object, object]:
        buyer = await authenticated_client("chat-validation-buyer")
        seller = await authenticated_client("chat-validation-seller")
        try:
            _, thread_id = await create_matched_thread(buyer, seller)
            invalid = []
            for body in ("   ", "가" * 2001):
                invalid.append(
                    await buyer.post(f"/api/chats/{thread_id}/messages", json={"body": body})
                )
            detail = await buyer.get(f"/api/chats/{thread_id}")
            anonymous = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
            try:
                anonymous_detail = await anonymous.get(f"/api/chats/{thread_id}")
            finally:
                await anonymous.aclose()
            return invalid, detail, anonymous_detail
        finally:
            await buyer.aclose()
            await seller.aclose()

    invalid, detail, anonymous_detail = asyncio.run(scenario())

    for response in invalid:
        assert response.status_code == 400
        assert response.json()["code"] == "invalid_input"
    assert detail.status_code == 200
    assert detail.json()["messages"] == []
    assert anonymous_detail.status_code == 401
    assert anonymous_detail.json()["code"] == "authentication_required"
