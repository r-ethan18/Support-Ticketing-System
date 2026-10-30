import pytest
from fastapi.testclient import TestClient

from backend.schemas.enums import Role
from tests.conftest import PASSWORD, Seeder, login_as

TICKET = "/api/v1/tickets/00000000-0000-0000-0000-000000000000"


def test_login_returns_bearer_token(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/token",
        json={"email": "requester@example.com", "password": PASSWORD},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["tokenType"] == "bearer"
    assert body["accessToken"]
    assert body["expiresIn"] > 0


def test_login_is_case_insensitive_on_email(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/token",
        json={"email": "Requester@Example.com", "password": PASSWORD},
    )
    assert response.status_code == 200


def test_login_wrong_password_and_unknown_email_look_identical(
    client: TestClient,
) -> None:
    wrong = client.post(
        "/api/v1/auth/token",
        json={"email": "requester@example.com", "password": "nope"},
    )
    unknown = client.post(
        "/api/v1/auth/token",
        json={"email": "nobody@example.com", "password": PASSWORD},
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_protected_route_requires_token(client: TestClient) -> None:
    assert client.get("/api/v1/tickets").status_code == 401


def test_protected_route_rejects_bad_token(client: TestClient) -> None:
    response = client.get("/api/v1/tickets", headers={"Authorization": "Bearer junk"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_valid_token_passes_auth(db_client: TestClient, seed: Seeder) -> None:
    _, headers = login_as(db_client, seed, Role.requester)
    assert db_client.get("/api/v1/tickets", headers=headers).status_code == 200


def test_supervisor_only_route(db_client: TestClient, seed: Seeder) -> None:
    body = {"assigneeId": "00000000-0000-0000-0000-000000000001"}
    url = f"{TICKET}/assignments"
    statuses = {
        role: db_client.post(
            url, json=body, headers=login_as(db_client, seed, role)[1]
        ).status_code
        for role in (Role.requester, Role.assignee, Role.supervisor)
    }
    # 404 (no such ticket) means the role gate let the supervisor through.
    assert statuses == {
        Role.requester: 403,
        Role.assignee: 403,
        Role.supervisor: 404,
    }


def test_admin_passes_every_role_gate(db_client: TestClient, seed: Seeder) -> None:
    _, admin = login_as(db_client, seed, Role.admin)
    assignment = db_client.post(
        f"{TICKET}/assignments",
        json={"assigneeId": "00000000-0000-0000-0000-000000000001"},
        headers=admin,
    )
    unassign = db_client.delete(
        f"{TICKET}/assignments/00000000-0000-0000-0000-000000000002", headers=admin
    )
    assert assignment.status_code == unassign.status_code == 404


def _login(client: TestClient, email: str, password: str) -> int:
    return client.post(
        "/api/v1/auth/token", json={"email": email, "password": password}
    ).status_code


def test_change_password(db_client: TestClient, seed: Seeder) -> None:
    _, headers = login_as(db_client, seed, Role.requester)
    email = db_client.get("/api/v1/auth/me", headers=headers).json()["email"]
    new = "a brand new passphrase"

    response = db_client.post(
        "/api/v1/auth/password",
        headers=headers,
        json={"currentPassword": PASSWORD, "newPassword": new},
    )
    assert response.status_code == 204
    assert _login(db_client, email, PASSWORD) == 401
    assert _login(db_client, email, new) == 200


@pytest.mark.parametrize(
    ("current", "new"),
    [
        ("wrong password entirely", "a brand new passphrase"),  # wrong current
        (PASSWORD, PASSWORD),  # unchanged
        (PASSWORD, "short"),  # fails validation
    ],
)
def test_change_password_rejections(
    db_client: TestClient, seed: Seeder, current: str, new: str
) -> None:
    _, headers = login_as(db_client, seed, Role.requester)
    response = db_client.post(
        "/api/v1/auth/password",
        headers=headers,
        json={"currentPassword": current, "newPassword": new},
    )
    assert response.status_code in (400, 422)


def test_change_password_requires_auth(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/password",
        json={"currentPassword": PASSWORD, "newPassword": "a brand new passphrase"},
    )
    assert response.status_code == 401
