"""Password security primitives owned by the application.

The hash format is deliberately self-describing so its cost parameters can be
upgraded without storing a plaintext password or changing the database schema.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets


_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SALT_BYTES = 16
_DERIVED_KEY_BYTES = 32
_SESSION_TOKEN_BYTES = 32


def hash_password(password: str) -> str:
    """Return a salted scrypt hash; never persist or log ``password`` itself."""
    salt = os.urandom(_SALT_BYTES)
    derived_key = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_DERIVED_KEY_BYTES,
    )
    return "$".join(
        (
            "scrypt",
            str(_SCRYPT_N),
            str(_SCRYPT_R),
            str(_SCRYPT_P),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(derived_key).decode("ascii"),
        )
    )


def verify_password(password: str, encoded_hash: str) -> bool:
    """Constant-time verification for hashes made by :func:`hash_password`."""
    try:
        algorithm, n, r, p, encoded_salt, encoded_key = encoded_hash.split("$")
        if algorithm != "scrypt":
            return False
        salt = base64.b64decode(encoded_salt, validate=True)
        expected_key = base64.b64decode(encoded_key, validate=True)
        actual_key = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected_key),
        )
    except (ValueError, TypeError):
        return False

    return hmac.compare_digest(actual_key, expected_key)


def generate_session_token() -> str:
    """Create an opaque browser credential backed by 256 bits of CSPRNG data."""
    return secrets.token_urlsafe(_SESSION_TOKEN_BYTES)


def hash_session_token(token: str) -> str:
    """Return the one-way session identifier that is safe to persist."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
