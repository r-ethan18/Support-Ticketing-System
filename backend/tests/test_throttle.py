import pytest
from fastapi.testclient import TestClient

from backend.config import get_settings
from backend.schemas.enums import Role
from tests.conftest import PASSWORD, Seeder, login_as

TOKEN = "/api/v1/auth/token"


@pytest.fixture(autouse=True)
def _clean_throttle(seed: Seeder, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LOGIN_MAX_FAILURES", "3")
    get_settings.cache_clear()
    seed.conn.execute("DELETE FROM login_throttle")
    yield
    seed.conn.execute("DELETE FROM login_throttle")


def _email(client: TestClient, seed: Seeder) -> str:
    _, headers = login_as(client, seed, Role.requester)
    return client.get("/api/v1/auth/me", headers=headers).json()["email"]


def _attempt(client: TestClient, email: str, password: str):
    return client.post(TOKEN, json={"email": email, "password": password})


def test_account_is_locked_after_repeated_failures(
    db_client: TestClient, seed: Seeder
) -> None:
    email = _email(db_client, seed)
    seed.conn.execute("DELETE FROM login_throttle")  # forget the setup login

    for _ in range(3):
        assert _attempt(db_client, email, "wrong password!!").status_code == 401
    locked = _attempt(db_client, email, PASSWORD)  # even the right password
    assert locked.status_code == 429
    assert int(locked.headers["retry-after"]) > 0


def test_success_resets_the_counter(db_client: TestClient, seed: Seeder) -> None:
    email = _email(db_client, seed)
    seed.conn.execute("DELETE FROM login_throttle")

    for _ in range(2):
        _attempt(db_client, email, "wrong password!!")
    assert _attempt(db_client, email, PASSWORD).status_code == 200
    for _ in range(2):
        assert _attempt(db_client, email, "wrong password!!").status_code == 401
    assert _attempt(db_client, email, PASSWORD).status_code == 200


def test_lockout_expires(db_client: TestClient, seed: Seeder) -> None:
    email = _email(db_client, seed)
    seed.conn.execute("DELETE FROM login_throttle")
    for _ in range(3):
        _attempt(db_client, email, "wrong password!!")
    assert _attempt(db_client, email, PASSWORD).status_code == 429

    seed.conn.execute(
        "UPDATE login_throttle SET locked_until = now() - interval '1 second'"
    )
    assert _attempt(db_client, email, PASSWORD).status_code == 200


def test_unknown_emails_are_throttled_too(db_client: TestClient) -> None:
    for _ in range(3):
        assert (
            _attempt(db_client, "ghost@example.com", "whatever 123456").status_code
            == 401
        )
    assert (
        _attempt(db_client, "ghost@example.com", "whatever 123456").status_code == 429
    )


def test_wrong_current_password_is_throttled(
    db_client: TestClient, seed: Seeder
) -> None:
    _, headers = login_as(db_client, seed, Role.requester)
    body = {
        "currentPassword": "not my password",
        "newPassword": "a brand new passphrase",
    }
    for _ in range(3):
        assert (
            db_client.post(
                "/api/v1/auth/password", headers=headers, json=body
            ).status_code
            == 400
        )
    good = {**body, "currentPassword": PASSWORD}
    assert (
        db_client.post("/api/v1/auth/password", headers=headers, json=good).status_code
        == 429
    )
