import pytest
from fastapi.testclient import TestClient

from backend.schemas.enums import Role
from tests.conftest import login

ADMINS = "/api/v1/admins"
BODY = {
    "name": "Ada",
    "email": "ada@example.com",
    "phone": "+10000000000",
    "password": "a-long-enough-password",
}


def test_requires_token(client: TestClient) -> None:
    assert client.post(ADMINS, json=BODY).status_code == 401


@pytest.mark.parametrize("role", [Role.requester, Role.assignee, Role.supervisor])
def test_non_admins_forbidden(client: TestClient, role: Role) -> None:
    response = client.post(ADMINS, json=BODY, headers=login(client, role))
    assert response.status_code == 403


def test_non_admin_gets_403_even_with_invalid_body(client: TestClient) -> None:
    response = client.post(ADMINS, json={}, headers=login(client, Role.requester))
    assert response.status_code == 403


def test_admin_passes_gate(client: TestClient) -> None:
    # Handler is still a skeleton: 501 means the gate and validation let us through.
    response = client.post(ADMINS, json=BODY, headers=login(client, Role.admin))
    assert response.status_code == 501


def test_short_password_rejected(client: TestClient) -> None:
    body = BODY | {"password": "short"}
    response = client.post(ADMINS, json=body, headers=login(client, Role.admin))
    assert response.status_code == 422
