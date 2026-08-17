import asyncio
import base64
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from app.main import app


PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLq3gAAAABJRU5ErkJggg=="
)


async def authenticated_client(label: str) -> AsyncClient:
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    credentials = {
        "email": f"{label}-{uuid4().hex}@example.com",
        "password": "password123",
        "password_confirmation": "password123",
        "display_name": f"{label[:8]}-{uuid4().hex[:12]}",
    }
    assert (await client.post("/api/auth/signup", json=credentials)).status_code == 201
    assert (await client.post("/api/auth/login", json={"email": credentials["email"], "password": credentials["password"]})).status_code == 200
    return client


async def create_request(owner: AsyncClient) -> str:
    response = await owner.post("/api/requests", json={
        "title": "아이폰 14 프로 128GB 자급제",
        "category": "디지털기기",
        "desiredPrice": 750000,
        "description": "상태 좋은 자급제 아이폰을 찾고 있습니다.",
    })
    assert response.status_code == 201
    return response.json()["id"]


async def create_application(seller: AsyncClient, request_id: str) -> object:
    response = await seller.post(f"/api/requests/{request_id}/applications", json={
        "offeredPrice": 700000,
        "message": "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.",
    })
    assert response.status_code == 201
    return response


def image_files(count: int, *, content: bytes = PNG_BYTES) -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("images", (f"seller-file-{index}.png", content, "image/png")) for index in range(count)]


def test_seller_attaches_images_after_application_and_private_views_receive_signed_images() -> None:
    async def scenario() -> tuple[object, object, object, object]:
        owner = await authenticated_client("application-image-owner")
        seller = await authenticated_client("application-image-seller")
        try:
            request_id = await create_request(owner)
            created = await create_application(seller, request_id)
            application_id = created.json()["id"]
            uploaded = await seller.post(f"/api/applications/{application_id}/images", files=image_files(2))
            owner_list = await owner.get(f"/api/requests/{request_id}/applications")
            seller_mine = await seller.get("/api/applications/mine")
            return created, uploaded, owner_list, seller_mine
        finally:
            await owner.aclose()
            await seller.aclose()

    created, uploaded, owner_list, seller_mine = asyncio.run(scenario())

    assert created.json()["images"] == []
    assert uploaded.status_code == 201
    images = uploaded.json()["images"]
    assert [image["sortOrder"] for image in images] == [0, 1]
    assert all("application-images" in image["url"] for image in images)
    assert all("/public/" not in image["url"] for image in images)
    assert owner_list.status_code == seller_mine.status_code == 200
    assert owner_list.json()[0]["images"] == images
    assert seller_mine.json()[0]["images"] == images


def test_application_image_upload_requires_session_and_the_applying_seller() -> None:
    async def scenario() -> tuple[object, object, object, object]:
        owner = await authenticated_client("application-image-owner")
        seller = await authenticated_client("application-image-seller")
        outsider = await authenticated_client("application-image-outsider")
        anonymous = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        try:
            request_id = await create_request(owner)
            application_id = (await create_application(seller, request_id)).json()["id"]
            no_session = await anonymous.post(f"/api/applications/{application_id}/images", files=image_files(1))
            owner_attempt = await owner.post(f"/api/applications/{application_id}/images", files=image_files(1))
            outsider_attempt = await outsider.post(f"/api/applications/{application_id}/images", files=image_files(1))
            missing = await seller.post(f"/api/applications/{uuid4()}/images", files=image_files(1))
            return no_session, owner_attempt, outsider_attempt, missing
        finally:
            await owner.aclose()
            await seller.aclose()
            await outsider.aclose()
            await anonymous.aclose()

    no_session, owner_attempt, outsider_attempt, missing = asyncio.run(scenario())

    assert no_session.status_code == 401
    assert no_session.json()["code"] == "authentication_required"
    for response in (owner_attempt, outsider_attempt):
        assert response.status_code == 403
        assert response.json()["code"] == "not_application_owner"
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"


def test_application_image_upload_rejects_empty_invalid_oversized_and_cumulative_over_limit_batches() -> None:
    async def scenario() -> tuple[object, object, object, object, object, object]:
        owner = await authenticated_client("application-image-owner")
        seller = await authenticated_client("application-image-seller")
        try:
            request_id = await create_request(owner)
            application_id = (await create_application(seller, request_id)).json()["id"]
            no_files = await seller.post(f"/api/applications/{application_id}/images")
            invalid = await seller.post(f"/api/applications/{application_id}/images", files=image_files(1, content=b"bad image"))
            oversized = await seller.post(
                f"/api/applications/{application_id}/images",
                files=image_files(1, content=b"0" * (5 * 1024 * 1024 + 1)),
            )
            first_five = await seller.post(f"/api/applications/{application_id}/images", files=image_files(5))
            too_many = await seller.post(f"/api/applications/{application_id}/images", files=image_files(1))
            mine = await seller.get("/api/applications/mine")
            return no_files, invalid, oversized, first_five, too_many, mine
        finally:
            await owner.aclose()
            await seller.aclose()

    no_files, invalid, oversized, first_five, too_many, mine = asyncio.run(scenario())

    assert no_files.status_code == 400
    assert no_files.json()["code"] == "no_files"
    assert invalid.status_code == 400
    assert invalid.json()["code"] == "invalid_image"
    assert oversized.status_code == 400
    assert oversized.json()["code"] == "invalid_image"
    assert first_five.status_code == 201
    assert too_many.status_code == 409
    assert too_many.json()["code"] == "image_limit_exceeded"
    assert mine.status_code == 200
    assert len(mine.json()[0]["images"]) == 5
