from fastapi.testclient import TestClient

from backend.schemas.enums import Role
from tests.conftest import PASSWORD, login

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


def test_valid_token_passes_auth(client: TestClient) -> None:
    # Handlers are still skeletons, so getting 501 means auth let us through.
    response = client.get("/api/v1/tickets", headers=login(client, Role.requester))
    assert response.status_code == 501


def test_supervisor_only_route(client: TestClient) -> None:
    patch = {"priority": "high"}
    as_requester = client.patch(
        TICKET, json=patch, headers=login(client, Role.requester)
    )
    as_supervisor = client.patch(
        TICKET, json=patch, headers=login(client, Role.supervisor)
    )
    assert as_requester.status_code == 403
    assert as_supervisor.status_code == 501
