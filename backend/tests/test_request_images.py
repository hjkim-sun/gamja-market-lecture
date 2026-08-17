import asyncio
import base64
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from app.main import app


PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLq3gAAAABJRU5ErkJggg=="
)


def request_payload() -> dict[str, object]:
    return {
        "title": "아이폰 14 프로 128GB 자급제",
        "category": "디지털기기",
        "desiredPrice": 750000,
        "description": "상태 좋은 자급제 아이폰을 찾고 있습니다.",
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
    assert (await client.post("/api/auth/login", json={"email": credentials["email"], "password": credentials["password"]})).status_code == 200
    return client


async def create_request(client: AsyncClient) -> str:
    response = await client.post("/api/requests", json=request_payload())
    assert response.status_code == 201
    return response.json()["id"]


def image_files(count: int, *, content: bytes = PNG_BYTES, content_type: str = "image/png") -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("images", (f"untrusted-name-{index}.png", content, content_type)) for index in range(count)]


def test_request_owner_attaches_multiple_images_after_creation_and_public_reads_include_them() -> None:
    async def scenario() -> tuple[object, object, object, object]:
        owner = await authenticated_client("request-image-owner")
        try:
            request_id = await create_request(owner)
            uploaded = await owner.post(f"/api/requests/{request_id}/images", files=image_files(2))
            detail = await owner.get(f"/api/requests/{request_id}")
            listed = await owner.get("/api/requests")
            mine = await owner.get("/api/requests/mine")
            return uploaded, detail, listed, mine
        finally:
            await owner.aclose()

    uploaded, detail, listed, mine = asyncio.run(scenario())

    assert uploaded.status_code == 201
    images = uploaded.json()["images"]
    assert [image["sortOrder"] for image in images] == [0, 1]
    assert all(image["id"] for image in images)
    assert all("request-images" in image["url"] for image in images)
    for response in (detail, listed, mine):
        assert response.status_code == 200
    assert detail.json()["images"] == images
    assert listed.json()[0]["images"] == images
    assert mine.json()[0]["images"] == images


def test_request_image_upload_requires_session_and_the_request_owner() -> None:
    async def scenario() -> tuple[object, object, object]:
        owner = await authenticated_client("request-image-owner")
        other = await authenticated_client("request-image-other")
        anonymous = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        try:
            request_id = await create_request(owner)
            no_session = await anonymous.post(f"/api/requests/{request_id}/images", files=image_files(1))
            wrong_owner = await other.post(f"/api/requests/{request_id}/images", files=image_files(1))
            missing = await owner.post(f"/api/requests/{uuid4()}/images", files=image_files(1))
            return no_session, wrong_owner, missing
        finally:
            await owner.aclose()
            await other.aclose()
            await anonymous.aclose()

    no_session, wrong_owner, missing = asyncio.run(scenario())

    assert no_session.status_code == 401
    assert no_session.json()["code"] == "authentication_required"
    assert wrong_owner.status_code == 403
    assert wrong_owner.json()["code"] == "not_request_owner"
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"


def test_request_image_upload_rejects_empty_invalid_oversized_and_cumulative_over_limit_batches() -> None:
    async def scenario() -> tuple[object, object, object, object, object, object]:
        owner = await authenticated_client("request-image-validation")
        try:
            request_id = await create_request(owner)
            no_files = await owner.post(f"/api/requests/{request_id}/images")
            invalid = await owner.post(
                f"/api/requests/{request_id}/images",
                files=image_files(1, content=b"not an image", content_type="image/png"),
            )
            oversized = await owner.post(
                f"/api/requests/{request_id}/images",
                files=image_files(1, content=b"0" * (5 * 1024 * 1024 + 1)),
            )
            first_five = await owner.post(f"/api/requests/{request_id}/images", files=image_files(5))
            too_many = await owner.post(f"/api/requests/{request_id}/images", files=image_files(1))
            detail = await owner.get(f"/api/requests/{request_id}")
            return no_files, invalid, oversized, first_five, too_many, detail
        finally:
            await owner.aclose()

    no_files, invalid, oversized, first_five, too_many, detail = asyncio.run(scenario())

    assert no_files.status_code == 400
    assert no_files.json()["code"] == "no_files"
    assert invalid.status_code == 400
    assert invalid.json()["code"] == "invalid_image"
    assert oversized.status_code == 400
    assert oversized.json()["code"] == "invalid_image"
    assert first_five.status_code == 201
    assert too_many.status_code == 409
    assert too_many.json()["code"] == "image_limit_exceeded"
    assert detail.status_code == 200
    assert len(detail.json()["images"]) == 5
