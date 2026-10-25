from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest

from backend.config import get_settings
from backend.schemas.enums import Role
from backend.security import (
    InvalidAccessToken,
    decode_access_token,
    encode_access_token,
    hash_password,
    verify_password,
)


def test_password_roundtrip() -> None:
    hashed = hash_password("hunter2")
    assert hashed != "hunter2"
    assert verify_password("hunter2", hashed)
    assert not verify_password("hunter3", hashed)


def test_unknown_account_never_verifies() -> None:
    assert not verify_password("anything", None)


def test_token_roundtrip() -> None:
    person_id = uuid4()
    token, expires_in = encode_access_token(person_id, Role.supervisor)
    assert expires_in == get_settings().access_token_ttl_seconds
    assert decode_access_token(token) == (person_id, Role.supervisor)


def _forge(**overrides: object) -> str:
    now = datetime.now(UTC)
    claims: dict[str, object] = {
        "sub": str(uuid4()),
        "role": "requester",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    } | overrides
    return jwt.encode(claims, get_settings().jwt_secret, algorithm="HS256")


def test_garbage_rejected() -> None:
    with pytest.raises(InvalidAccessToken):
        decode_access_token("not-a-jwt")


def test_expired_rejected() -> None:
    with pytest.raises(InvalidAccessToken):
        decode_access_token(_forge(exp=datetime.now(UTC) - timedelta(seconds=1)))


def test_wrong_signature_rejected() -> None:
    token = jwt.encode({"sub": str(uuid4())}, "y" * 32, algorithm="HS256")
    with pytest.raises(InvalidAccessToken):
        decode_access_token(token)


def test_unsigned_token_rejected() -> None:
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": str(uuid4()),
            "role": "supervisor",
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        None,
        algorithm="none",
    )
    with pytest.raises(InvalidAccessToken):
        decode_access_token(token)


@pytest.mark.parametrize("overrides", [{"role": "admin"}, {"sub": "not-a-uuid"}])
def test_bad_claims_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(InvalidAccessToken):
        decode_access_token(_forge(**overrides))
