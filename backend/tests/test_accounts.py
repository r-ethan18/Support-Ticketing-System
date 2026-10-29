from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.config import get_settings
from backend.main import create_app
from backend.schemas.enums import Role

from .conftest import PASSWORD, Seeder, login_as

API = "/api/v1"


def new_email() -> str:
    return f"{uuid4().hex}@example.com"


def sign_in(client: TestClient, email: str, password: str = PASSWORD):
    return client.post(f"{API}/auth/token", json={"email": email, "password": password})


def forget(seed: Seeder, person_id: str) -> None:
    """Register for cleanup a person created through the API."""
    seed._created.append(("person", person_id))


@pytest.fixture
def departments(seed: Seeder) -> dict[str, object]:
    return {
        "dept": seed.insert("department", name=f"Dept {uuid4().hex[:6]}"),
        "cat": seed.insert("category", name=f"Cat {uuid4().hex[:6]}"),
        "vendor": seed.insert("vendor", name=f"Vendor {uuid4().hex[:6]}"),
    }


def test_register_creates_requester_who_can_log_in(
    db_client: TestClient, seed: Seeder
) -> None:
    email = new_email()
    response = db_client.post(
        f"{API}/auth/register",
        json={"name": "Rae", "email": email, "phone": "+1", "password": PASSWORD},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    forget(seed, body["id"])
    assert body["role"] == "requester"
    assert "password" not in str(body).lower()

    token = sign_in(db_client, email)
    assert token.status_code == 200
    me = db_client.get(
        f"{API}/auth/me",
        headers={"Authorization": f"Bearer {token.json()['accessToken']}"},
    )
    assert me.json()["id"] == body["id"]


def test_register_ignores_requested_role(db_client: TestClient, seed: Seeder) -> None:
    response = db_client.post(
        f"{API}/auth/register",
        json={
            "name": "Mallory",
            "email": new_email(),
            "phone": "+1",
            "password": PASSWORD,
            "role": "admin",
        },
    )
    forget(seed, response.json()["id"])
    assert response.json()["role"] == "requester"


def test_register_duplicate_email_conflicts_case_insensitively(
    db_client: TestClient, seed: Seeder
) -> None:
    email = new_email()
    body = {"name": "A", "email": email, "phone": "+1", "password": PASSWORD}
    first = db_client.post(f"{API}/auth/register", json=body)
    forget(seed, first.json()["id"])
    second = db_client.post(
        f"{API}/auth/register", json=body | {"email": email.upper()}
    )
    assert second.status_code == 409


def test_register_short_password_rejected(db_client: TestClient) -> None:
    response = db_client.post(
        f"{API}/auth/register",
        json={"name": "A", "email": new_email(), "phone": "+1", "password": "short"},
    )
    assert response.status_code == 422


def test_admin_creates_admin(db_client: TestClient, seed: Seeder) -> None:
    _, headers = login_as(db_client, seed, Role.admin)
    email = new_email()
    response = db_client.post(
        f"{API}/admins",
        json={"name": "Ada", "email": email, "phone": "+1", "password": PASSWORD},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    forget(seed, response.json()["id"])
    assert response.json()["role"] == "admin"
    assert sign_in(db_client, email).status_code == 200


def test_me_requires_token(db_client: TestClient) -> None:
    assert db_client.get(f"{API}/auth/me").status_code == 401


def test_admin_promotes_signed_up_person_to_supervisor_then_assignee(
    db_client: TestClient, seed: Seeder, departments: dict[str, object]
) -> None:
    _, admin = login_as(db_client, seed, Role.admin)
    person = seed.person(Role.requester)
    url = f"{API}/people/{person}/role"

    supervisor = db_client.put(
        url,
        json={"role": "supervisor", "departmentId": str(departments["dept"])},
        headers=admin,
    )
    assert supervisor.status_code == 200, supervisor.text
    assert supervisor.json()["role"] == "supervisor"
    assert supervisor.json()["departmentId"] == str(departments["dept"])

    # Switching roles replaces the department with the vendor.
    assignee = db_client.put(
        url,
        json={"role": "assignee", "vendorId": str(departments["vendor"])},
        headers=admin,
    )
    assert assignee.json()["vendorId"] == str(departments["vendor"])
    assert assignee.json()["departmentId"] is None

    demoted = db_client.put(url, json={"role": "requester"}, headers=admin)
    assert demoted.json()["role"] == "requester"
    assert demoted.json()["vendorId"] is None


def test_new_role_applies_at_next_login(
    db_client: TestClient, seed: Seeder, departments: dict[str, object]
) -> None:
    _, admin = login_as(db_client, seed, Role.admin)
    person = seed.person(Role.requester)
    db_client.put(
        f"{API}/people/{person}/role",
        json={"role": "supervisor", "departmentId": str(departments["dept"])},
        headers=admin,
    )
    email = seed.conn.execute(
        "SELECT email FROM person WHERE id = %s", (person,)
    ).fetchone()[0]
    token = sign_in(db_client, email).json()["accessToken"]
    me = db_client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["role"] == "supervisor"
    assert (
        db_client.get(
            f"{API}/people", headers={"Authorization": f"Bearer {token}"}
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "body",
    [
        {"role": "admin"},
        {"role": "supervisor"},  # no department
        {"role": "assignee"},  # no vendor
        {"role": "requester", "vendorId": str(uuid4())},
        {"role": "assignee", "vendorId": str(uuid4()), "departmentId": str(uuid4())},
        {"role": "supervisor", "departmentId": str(uuid4()), "vendorId": str(uuid4())},
    ],
)
def test_role_assignment_validates_fields(
    db_client: TestClient, seed: Seeder, body: dict[str, object]
) -> None:
    _, admin = login_as(db_client, seed, Role.admin)
    person = seed.person(Role.requester)
    response = db_client.put(f"{API}/people/{person}/role", json=body, headers=admin)
    assert response.status_code == 422


def test_role_assignment_unknown_references_and_targets(
    db_client: TestClient, seed: Seeder
) -> None:
    _, admin = login_as(db_client, seed, Role.admin)
    person = seed.person(Role.requester)
    unknown = db_client.put(
        f"{API}/people/{person}/role",
        json={"role": "supervisor", "departmentId": str(uuid4())},
        headers=admin,
    )
    assert unknown.status_code == 422
    other_admin = seed.person(Role.admin)
    assert (
        db_client.put(
            f"{API}/people/{other_admin}/role",
            json={"role": "requester"},
            headers=admin,
        ).status_code
        == 403
    )
    assert (
        db_client.put(
            f"{API}/people/{uuid4()}/role", json={"role": "requester"}, headers=admin
        ).status_code
        == 404
    )


@pytest.mark.parametrize("role", [Role.requester, Role.assignee, Role.supervisor])
def test_only_admins_assign_roles(
    db_client: TestClient, seed: Seeder, role: Role
) -> None:
    _, headers = login_as(db_client, seed, role)
    response = db_client.put(
        f"{API}/people/{uuid4()}/role", json={"role": "requester"}, headers=headers
    )
    assert response.status_code == 403


@pytest.mark.parametrize("role", [Role.requester, Role.assignee, Role.supervisor])
def test_non_admins_cannot_delete_staff(
    db_client: TestClient, seed: Seeder, role: Role
) -> None:
    _, headers = login_as(db_client, seed, role)
    assert (
        db_client.delete(f"{API}/people/{uuid4()}", headers=headers).status_code == 403
    )


def test_admin_deletes_staff_but_not_requesters_or_admins(
    db_client: TestClient, seed: Seeder
) -> None:
    _, admin = login_as(db_client, seed, Role.admin)
    assignee = seed.person(Role.assignee)
    requester = seed.person(Role.requester)
    other_admin = seed.person(Role.admin)

    assert (
        db_client.delete(f"{API}/people/{assignee}", headers=admin).status_code == 204
    )
    assert db_client.get(f"{API}/people/{assignee}", headers=admin).status_code == 404
    assert (
        db_client.delete(f"{API}/people/{requester}", headers=admin).status_code == 403
    )
    assert (
        db_client.delete(f"{API}/people/{other_admin}", headers=admin).status_code
        == 403
    )
    assert db_client.delete(f"{API}/people/{uuid4()}", headers=admin).status_code == 404


def test_people_visibility(db_client: TestClient, seed: Seeder) -> None:
    requester_id, requester = login_as(db_client, seed, Role.requester)
    other_requester = seed.person(Role.requester)
    staff = seed.person(Role.assignee)
    _, supervisor = login_as(db_client, seed, Role.supervisor)

    assert db_client.get(f"{API}/people", headers=requester).status_code == 403
    assert db_client.get(f"{API}/people", headers=supervisor).status_code == 200

    assert (
        db_client.get(f"{API}/people/{requester_id}", headers=requester).status_code
        == 200
    )
    assert db_client.get(f"{API}/people/{staff}", headers=requester).status_code == 200
    assert (
        db_client.get(f"{API}/people/{other_requester}", headers=requester).status_code
        == 403
    )
    assert (
        db_client.get(f"{API}/people/{other_requester}", headers=supervisor).status_code
        == 200
    )


def test_people_search_and_role_filter(db_client: TestClient, seed: Seeder) -> None:
    _, admin = login_as(db_client, seed, Role.admin)
    assignee = seed.person(Role.assignee)
    email = seed.conn.execute(
        "SELECT email FROM person WHERE id = %s", (assignee,)
    ).fetchone()[0]
    found = db_client.get(
        f"{API}/people", params={"q": email, "role": "assignee"}, headers=admin
    )
    assert [p["id"] for p in found.json()["items"]] == [str(assignee)]
    none = db_client.get(
        f"{API}/people", params={"q": email, "role": "supervisor"}, headers=admin
    )
    assert none.json()["total"] == 0


@pytest.fixture
def scratch_db(seed: Seeder, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    """An empty database of its own, so the first-run path can be exercised."""
    name = f"sts_firstrun_{uuid4().hex[:8]}"
    seed.conn.execute(f'CREATE DATABASE "{name}"')
    monkeypatch.setenv("DB_NAME", name)
    get_settings.cache_clear()
    try:
        yield name
    finally:
        get_settings.cache_clear()
        seed.conn.execute(f'DROP DATABASE "{name}" WITH (FORCE)')


def test_first_run_creates_admin_and_refuses_without_settings(
    scratch_db: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ADMIN_EMAIL", "")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="ADMIN_EMAIL"), TestClient(create_app()):
        pass

    email = new_email()
    monkeypatch.setenv("ADMIN_EMAIL", email)
    get_settings.cache_clear()
    with TestClient(create_app()) as client:
        token = sign_in(client, email)
        assert token.status_code == 200
        me = client.get(
            f"{API}/auth/me",
            headers={"Authorization": f"Bearer {token.json()['accessToken']}"},
        )
        assert me.json()["role"] == "admin"

    # A second start finds the admin and creates nothing more.
    with TestClient(create_app()) as client:
        assert sign_in(client, email).status_code == 200
        page = client.get(
            f"{API}/people",
            params={"role": "admin"},
            headers={
                "Authorization": "Bearer "
                + sign_in(client, email).json()["accessToken"]
            },
        )
        assert page.json()["total"] == 1
