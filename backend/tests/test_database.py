from collections.abc import Iterator
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from backend.config import DatabaseSettings, get_settings
from backend.db import SCHEMA_PATH
from backend.main import create_app
from backend.security import hash_password

from .conftest import PASSWORD, database_unreachable

EMAIL = "Db.User@Example.com"


def test_database_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"):
        monkeypatch.delenv(key, raising=False)
    get_settings.cache_clear()
    db = get_settings().database
    assert (db.host, db.port, db.name, db.user) == ("localhost", 5432, "sts", "sts")


def test_database_settings_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in {
        "DB_HOST": "db",
        "DB_PORT": "6543",
        "DB_NAME": "tickets",
        "DB_USER": "app",
        "DB_PASSWORD": "pw",
    }.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    assert get_settings().database == DatabaseSettings(
        "db", 6543, "tickets", "app", "pw"
    )


def test_conninfo_quotes_special_characters() -> None:
    info = DatabaseSettings(password="it's a secret").conninfo
    assert psycopg.conninfo.conninfo_to_dict(info)["password"] == "it's a secret"


@pytest.fixture
def seeded_db() -> Iterator[UUID]:
    conninfo = get_settings().database.conninfo
    try:
        conn = psycopg.connect(conninfo, connect_timeout=2, autocommit=True)
    except psycopg.OperationalError as exc:
        database_unreachable(exc)
    with conn:
        conn.execute(SCHEMA_PATH.read_text())
        person_id = conn.execute(
            "INSERT INTO person (name, email, role) VALUES (%s, %s, 'requester')"
            " RETURNING id",
            ("Db User", EMAIL),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO person_credential (person_id, password_hash) VALUES (%s, %s)",
            (person_id, hash_password(PASSWORD)),
        )
        try:
            yield person_id
        finally:
            conn.execute("DELETE FROM person WHERE id = %s", (person_id,))


@pytest.fixture
def db_client(seeded_db: UUID) -> Iterator[TestClient]:
    with TestClient(create_app()) as client:
        yield client


def login(client: TestClient, email: str, password: str):
    return client.post(
        "/api/v1/auth/token", json={"email": email, "password": password}
    )


def test_login_against_postgres_is_case_insensitive(db_client: TestClient) -> None:
    response = login(db_client, EMAIL.lower(), PASSWORD)
    assert response.status_code == 200, response.text


def test_login_rejects_wrong_password(db_client: TestClient) -> None:
    assert login(db_client, EMAIL, "not the password").status_code == 401


def test_login_rejects_unknown_email(db_client: TestClient) -> None:
    assert login(db_client, "nobody@example.com", PASSWORD).status_code == 401


def test_schema_bootstrap_is_idempotent(seeded_db: UUID) -> None:
    with TestClient(create_app()), TestClient(create_app()):
        pass
