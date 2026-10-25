from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.config import get_settings
from backend.credentials import Credential, get_credential_store
from backend.main import create_app
from backend.schemas.enums import Role
from backend.security import hash_password

SECRET = "x" * 32
PASSWORD = "correct horse battery staple"


class InMemoryStore:
    def __init__(self, by_email: dict[str, Credential]) -> None:
        self._by_email = by_email

    async def get_by_email(self, email: str) -> Credential | None:
        return self._by_email.get(email.lower())


@pytest.fixture(autouse=True)
def _settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("JWT_SECRET", SECRET)
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
    app = create_app()
    app.dependency_overrides[get_credential_store] = lambda: store
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
