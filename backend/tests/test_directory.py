from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.schemas.enums import Role

from .conftest import Seeder, login_as

API = "/api/v1"
KINDS = [
    ("departments", "department"),
    ("vendors", "vendor"),
    ("categories", "category"),
]


def create(client, seed: Seeder, path: str, table: str, headers, name: str):
    response = client.post(f"{API}/{path}", json={"name": name}, headers=headers)
    if response.status_code == 201:
        seed._created.append((table, response.json()["id"]))
    return response


@pytest.mark.parametrize(("path", "table"), KINDS)
def test_admin_creates_and_deletes(
    db_client: TestClient, seed: Seeder, path: str, table: str
) -> None:
    _, admin = login_as(db_client, seed, Role.admin)
    name = f"Name {uuid4().hex[:8]}"
    created = create(db_client, seed, path, table, admin, name)
    assert created.status_code == 201, created.text
    assert created.json()["name"] == name
    row_id = created.json()["id"]
    assert db_client.get(f"{API}/{path}/{row_id}", headers=admin).status_code == 200

    # Names are unique, ignoring case.
    again = create(db_client, seed, path, table, admin, name.upper())
    assert again.status_code == 409

    assert db_client.delete(f"{API}/{path}/{row_id}", headers=admin).status_code == 204
    assert db_client.delete(f"{API}/{path}/{row_id}", headers=admin).status_code == 404
    assert create(db_client, seed, path, table, admin, "").status_code == 422


@pytest.mark.parametrize(("path", "table"), KINDS)
@pytest.mark.parametrize("role", [Role.requester, Role.assignee, Role.supervisor])
def test_non_admins_forbidden(
    db_client: TestClient, seed: Seeder, path: str, table: str, role: Role
) -> None:
    _, headers = login_as(db_client, seed, role)
    assert (
        db_client.post(f"{API}/{path}", json={"name": "x"}, headers=headers).status_code
        == 403
    )
    assert (
        db_client.delete(f"{API}/{path}/{uuid4()}", headers=headers).status_code == 403
    )


def test_cannot_delete_department_in_use(db_client: TestClient, seed: Seeder) -> None:
    _, admin = login_as(db_client, seed, Role.admin)
    dept = seed.insert("department", name=f"D {uuid4().hex[:8]}")
    cat = seed.insert("category", name=f"C {uuid4().hex[:8]}")
    seed.insert("asset", name="pump", department_id=dept, category_id=cat)
    assert (
        db_client.delete(f"{API}/departments/{dept}", headers=admin).status_code == 409
    )
