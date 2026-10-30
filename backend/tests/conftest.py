import os
from collections.abc import Iterator
from typing import Any, NoReturn
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from backend.config import get_settings
from backend.credentials import Credential, get_credential_store
from backend.db import SCHEMA_PATH
from backend.main import create_app
from backend.refresh_tokens import get_refresh_token_store
from backend.schemas.enums import Role
from backend.security import hash_password
from backend.throttle import get_throttle

SECRET = "x" * 32
PASSWORD = "correct horse battery staple"


class InMemoryStore:
    def __init__(self, by_email: dict[str, Credential]) -> None:
        self._by_email = by_email

    async def get_by_email(self, email: str) -> Credential | None:
        return self._by_email.get(email.lower())


class NoThrottle:
    async def check(self, keys: list[str]) -> None: ...

    async def record_failure(self, keys: list[str]) -> None: ...

    async def record_success(self, keys: list[str]) -> None: ...


class InMemoryRefreshTokens:
    """Enough for login tests that run without a database."""

    async def issue(self, person_id: UUID) -> str:
        return f"refresh-{person_id}"


@pytest.fixture(autouse=True)
def _settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("JWT_SECRET", SECRET)
    monkeypatch.setenv("ADMIN_EMAIL", "bootstrap-admin@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", PASSWORD)
    monkeypatch.setenv("METRICS_PORT", "0")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client() -> Iterator[TestClient]:
    password_hash = hash_password(PASSWORD)
    store = InMemoryStore(
        {
            f"{role}@example.com": Credential(
                person_id=uuid4(), role=role, password_hash=password_hash
            )
            for role in Role
        }
    )
    app = create_app(with_database=False)
    app.dependency_overrides[get_credential_store] = lambda: store
    app.dependency_overrides[get_throttle] = NoThrottle
    app.dependency_overrides[get_refresh_token_store] = InMemoryRefreshTokens
    with TestClient(app) as c:
        yield c


def login(client: TestClient, role: Role) -> dict[str, str]:
    """Log in as the seeded `role` person; return Authorization headers."""
    response = client.post(
        "/api/v1/auth/token",
        json={"email": f"{role}@example.com", "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def database_unreachable(exc: Exception) -> NoReturn:
    """Skip DB tests locally; fail them where a database is required (CI)."""
    message = f"Postgres not reachable ({exc}); set DB_* to run database tests"
    if os.environ.get("REQUIRE_DB"):
        pytest.fail(message)
    pytest.skip(message)


class Seeder:
    """Inserts rows into the real database and removes them again on teardown.

    Rows are deleted individually (newest first) rather than truncating, so the
    tests are safe to run against a database that holds other data.
    """

    def __init__(self, conn: psycopg.Connection) -> None:
        self.conn = conn
        self._created: list[tuple[str, UUID]] = []
        self._links: list[tuple[UUID, UUID]] = []

    def insert(self, table: str, **values: Any) -> UUID:
        columns = ", ".join(values)
        marks = ", ".join(["%s"] * len(values))
        row = self.conn.execute(
            f"INSERT INTO {table} ({columns}) VALUES ({marks}) RETURNING id",
            list(values.values()),
        ).fetchone()
        assert row is not None
        self._created.append((table, row[0]))
        return row[0]

    def person(self, role: Role, **extra: Any) -> UUID:
        person_id = self.insert(
            "person",
            name=f"{role} {uuid4().hex[:6]}",
            email=f"{uuid4().hex}@example.com",
            phone="+10000000000",
            role=role.value,
            **extra,
        )
        self.conn.execute(
            "INSERT INTO person_credential (person_id, password_hash) VALUES (%s, %s)",
            (person_id, hash_password(PASSWORD)),
        )
        return person_id

    def link_vendor(self, asset_id: UUID, vendor_id: UUID) -> None:
        self.conn.execute(
            "INSERT INTO asset_vendor (asset_id, vendor_id) VALUES (%s, %s)",
            (asset_id, vendor_id),
        )
        self._links.append((asset_id, vendor_id))

    def cleanup(self) -> None:
        for asset_id, vendor_id in self._links:
            self.conn.execute(
                "DELETE FROM asset_vendor WHERE asset_id = %s AND vendor_id = %s",
                (asset_id, vendor_id),
            )
        # Tickets reference people regardless of which was created first.
        newest_first = list(reversed(self._created))
        tickets = [row for row in newest_first if row[0] == "ticket"]
        rest = [row for row in newest_first if row[0] != "ticket"]
        for table, row_id in tickets + rest:
            self.conn.execute(f"DELETE FROM {table} WHERE id = %s", (row_id,))


@pytest.fixture
def seed() -> Iterator[Seeder]:
    try:
        conn = psycopg.connect(
            get_settings().database.conninfo, connect_timeout=2, autocommit=True
        )
    except psycopg.OperationalError as exc:
        database_unreachable(exc)
    with conn:
        conn.execute(SCHEMA_PATH.read_text())
        seeder = Seeder(conn)
        try:
            yield seeder
        finally:
            seeder.cleanup()


@pytest.fixture
def db_client(seed: Seeder) -> Iterator[TestClient]:
    with TestClient(create_app()) as c:
        yield c


def login_as(
    client: TestClient, seed: Seeder, role: Role, **extra: Any
) -> tuple[UUID, dict[str, str]]:
    """Create a `role` person in Postgres and log in; return `(id, headers)`."""
    person_id = seed.person(role, **extra)
    email = seed.conn.execute(
        "SELECT email FROM person WHERE id = %s", (person_id,)
    ).fetchone()[0]
    response = client.post(
        "/api/v1/auth/token", json={"email": email, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return person_id, {"Authorization": f"Bearer {response.json()['accessToken']}"}
