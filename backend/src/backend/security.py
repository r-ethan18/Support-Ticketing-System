"""Password hashing (pwdlib/Argon2) and access-token encoding (PyJWT/HS256).

Pure functions: no FastAPI, no database.
"""

from datetime import UTC, datetime, timedelta
from functools import lru_cache
from uuid import UUID

import jwt
from pwdlib import PasswordHash

from backend.config import get_settings
from backend.schemas.enums import Role

# Pinned, never read from the token header, so a token cannot pick its own algorithm.
JWT_ALGORITHM = "HS256"

_hasher = PasswordHash.recommended()


class InvalidAccessToken(Exception):
    """The token is malformed, forged, expired or carries bad claims."""


def hash_password(password: str) -> str:
    return _hasher.hash(password)


@lru_cache
def _dummy_hash() -> str:
    return _hasher.hash("not-a-real-password")


def verify_password(password: str, password_hash: str | None) -> bool:
    """Check `password` against `password_hash`.

    Pass `None` for an unknown account: a dummy hash is verified instead so the
    response time does not reveal whether the email exists.
    """
    if password_hash is None:
        _hasher.verify(password, _dummy_hash())
        return False
    return _hasher.verify(password, password_hash)


def encode_access_token(person_id: UUID, role: Role) -> tuple[str, int]:
    """Return `(token, expires_in_seconds)`."""
    settings = get_settings()
    now = datetime.now(UTC)
    ttl = settings.access_token_ttl_seconds
    claims = {
        "sub": str(person_id),
        "role": role.value,
        "iat": now,
        "exp": now + timedelta(seconds=ttl),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=JWT_ALGORITHM), ttl


def decode_access_token(token: str) -> tuple[UUID, Role]:
    """Return `(person_id, role)` or raise `InvalidAccessToken`."""
    try:
        claims = jwt.decode(
            token,
            get_settings().jwt_secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "role", "iat", "exp"]},
        )
        return UUID(claims["sub"]), Role(claims["role"])
    except (jwt.InvalidTokenError, ValueError) as exc:
        raise InvalidAccessToken from exc
