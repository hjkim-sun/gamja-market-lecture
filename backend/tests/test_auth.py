import asyncio
from uuid import UUID, uuid4

from httpx import ASGITransport, AsyncClient

from app.main import app


async def signup(payload: dict[str, object]):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post("/api/auth/signup", json=payload)


async def signup_then_login(payload: dict[str, object]):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        signup_response = await client.post("/api/auth/signup", json=payload)
        login_response = await client.post(
            "/api/auth/login",
            json={"email": payload["email"], "password": payload["password"]},
        )
        return signup_response, login_response


def test_signup_creates_a_normalized_public_user_without_secret_fields() -> None:
    password = "password123"
    response = asyncio.run(
        signup(
            {
                "email": "  BUYER@EXAMPLE.COM ",
                "password": password,
                "password_confirmation": password,
                "display_name": "  감자 구매자  ",
            }
        )
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"id", "email", "display_name"}
    assert body["email"] == "buyer@example.com"
    assert body["display_name"] == "감자 구매자"
    assert UUID(body["id"])
    assert password not in response.text
    assert not {key for key in body if "password" in key.lower() or "hash" in key.lower()}


def test_signup_rejects_malformed_email_and_short_password() -> None:
    malformed_email = asyncio.run(
        signup(
            {
                "email": "not-an-email",
                "password": "password123",
                "password_confirmation": "password123",
                "display_name": "감자 구매자",
            }
        )
    )
    short_password = asyncio.run(
        signup(
            {
                "email": "buyer@example.com",
                "password": "short",
                "password_confirmation": "short",
                "display_name": "감자 구매자",
            }
        )
    )

    for response in (malformed_email, short_password):
        assert response.status_code == 400
        body = response.json()
        assert body["code"] == "invalid_input"
        assert isinstance(body["message"], str)
        assert body["message"]


def test_signup_normalizes_email_before_enforcing_duplicate_address() -> None:
    unique_email = f"duplicate-{uuid4().hex}@example.com"

    first = asyncio.run(
        signup(
            {
                "email": f"  {unique_email.upper()} ",
                "password": "password123",
                "password_confirmation": "password123",
                "display_name": "감자 구매자",
            }
        )
    )
    duplicate = asyncio.run(
        signup(
            {
                "email": unique_email,
                "password": "password123",
                "password_confirmation": "password123",
                "display_name": "감자 판매자",
            }
        )
    )

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json() == {
        "code": "email_already_exists",
        "message": "이미 사용 중인 이메일이에요.",
    }


def test_signup_credentials_can_be_used_to_login() -> None:
    credentials = {
        "email": f"login-after-signup-{uuid4().hex}@example.com",
        "password": "password123",
    }

    signup_response, login_response = asyncio.run(
        signup_then_login(
            {
                **credentials,
                "password_confirmation": credentials["password"],
                "display_name": "감자 구매자",
            }
        )
    )

    assert signup_response.status_code == 201
    assert login_response.status_code == 200
    assert login_response.json()["email"] == credentials["email"]


def test_signup_rejects_password_confirmation_that_does_not_match_password() -> None:
    response = asyncio.run(
        signup(
            {
                "email": f"confirmation-{uuid4().hex}@example.com",
                "password": "password123",
                "password_confirmation": "different-password",
                "display_name": "감자 구매자",
            }
        )
    )

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_input"


def test_signup_rejects_blank_or_too_long_display_name() -> None:
    blank_name = asyncio.run(
        signup(
            {
                "email": f"blank-name-{uuid4().hex}@example.com",
                "password": "password123",
                "password_confirmation": "password123",
                "display_name": "   ",
            }
        )
    )
    too_long_name = asyncio.run(
        signup(
            {
                "email": f"long-name-{uuid4().hex}@example.com",
                "password": "password123",
                "password_confirmation": "password123",
                "display_name": "감" * 41,
            }
        )
    )

    for response in (blank_name, too_long_name):
        assert response.status_code == 400
        assert response.json()["code"] == "invalid_input"


def test_signup_rejects_duplicate_display_names() -> None:
    display_name = f"같은 감자-{uuid4().hex}"
    first = asyncio.run(
        signup(
            {
                "email": f"same-name-first-{uuid4().hex}@example.com",
                "password": "password123",
                "password_confirmation": "password123",
                "display_name": display_name,
            }
        )
    )
    second = asyncio.run(
        signup(
            {
                "email": f"same-name-second-{uuid4().hex}@example.com",
                "password": "password123",
                "password_confirmation": "password123",
                "display_name": display_name,
            }
        )
    )

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json() == {
        "code": "display_name_already_exists",
        "message": "이미 사용 중인 표시 이름이에요.",
    }
