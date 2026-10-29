from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.schemas.enums import Role

from .conftest import Seeder, login_as

API = "/api/v1/assets"


@pytest.fixture
def world(seed: Seeder) -> dict[str, object]:
    tag = uuid4().hex[:6]
    return {
        "dept": seed.insert("department", name=f"D {tag}"),
        "other": seed.insert("department", name=f"O {tag}"),
        "cat": seed.insert("category", name=f"C {tag}"),
        "cat2": seed.insert("category", name=f"C2 {tag}"),
    }


def body(world, **extra):
    return {"name": f"Pump {uuid4().hex[:6]}", "categoryId": str(world["cat"])} | extra


def track(seed: Seeder, response) -> None:
    if response.status_code == 201:
        seed._created.append(("asset", response.json()["id"]))


def test_supervisor_creates_asset_in_own_department(
    db_client: TestClient, seed: Seeder, world: dict[str, object]
) -> None:
    _, sup = login_as(db_client, seed, Role.supervisor, department_id=world["dept"])
    response = db_client.post(API, json=body(world), headers=sup)
    track(seed, response)
    assert response.status_code == 201, response.text
    assert response.json()["departmentId"] == str(world["dept"])

    explicit = db_client.post(
        API, json=body(world, departmentId=str(world["dept"])), headers=sup
    )
    track(seed, explicit)
    assert explicit.status_code == 201


def test_supervisor_cannot_use_another_department(
    db_client: TestClient, seed: Seeder, world: dict[str, object]
) -> None:
    _, sup = login_as(db_client, seed, Role.supervisor, department_id=world["dept"])
    response = db_client.post(
        API, json=body(world, departmentId=str(world["other"])), headers=sup
    )
    assert response.status_code == 403


def test_admin_must_name_department(
    db_client: TestClient, seed: Seeder, world: dict[str, object]
) -> None:
    _, admin = login_as(db_client, seed, Role.admin)
    assert db_client.post(API, json=body(world), headers=admin).status_code == 422
    ok = db_client.post(
        API, json=body(world, departmentId=str(world["other"])), headers=admin
    )
    track(seed, ok)
    assert ok.status_code == 201


def test_unknown_category_is_422(
    db_client: TestClient, seed: Seeder, world: dict[str, object]
) -> None:
    _, sup = login_as(db_client, seed, Role.supervisor, department_id=world["dept"])
    response = db_client.post(
        API, json=body(world) | {"categoryId": str(uuid4())}, headers=sup
    )
    assert response.status_code == 422


@pytest.mark.parametrize("role", [Role.requester, Role.assignee])
def test_others_cannot_manage_assets(
    db_client: TestClient, seed: Seeder, world: dict[str, object], role: Role
) -> None:
    _, headers = login_as(db_client, seed, role)
    assert db_client.post(API, json=body(world), headers=headers).status_code == 403
    assert (
        db_client.patch(f"{API}/{uuid4()}", json={}, headers=headers).status_code == 403
    )
    assert db_client.delete(f"{API}/{uuid4()}", headers=headers).status_code == 403


def test_update_and_delete_only_in_own_department(
    db_client: TestClient, seed: Seeder, world: dict[str, object]
) -> None:
    _, sup = login_as(db_client, seed, Role.supervisor, department_id=world["dept"])
    _, rival = login_as(db_client, seed, Role.supervisor, department_id=world["other"])
    created = db_client.post(API, json=body(world), headers=sup)
    track(seed, created)
    url = f"{API}/{created.json()['id']}"

    renamed = db_client.patch(
        url, json={"name": "Renamed", "categoryId": str(world["cat2"])}, headers=sup
    )
    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["categoryId"]) == (
        "Renamed",
        str(world["cat2"]),
    )
    assert db_client.patch(url, json={"name": "x"}, headers=rival).status_code == 403
    assert db_client.delete(url, headers=rival).status_code == 403
    assert db_client.patch(f"{API}/{uuid4()}", json={}, headers=sup).status_code == 404

    assert db_client.delete(url, headers=sup).status_code == 204
    assert db_client.get(url, headers=sup).status_code == 404


def test_cannot_delete_asset_with_tickets(
    db_client: TestClient, seed: Seeder, world: dict[str, object]
) -> None:
    _, sup = login_as(db_client, seed, Role.supervisor, department_id=world["dept"])
    _, owner = login_as(db_client, seed, Role.requester)
    created = db_client.post(API, json=body(world), headers=sup)
    track(seed, created)
    ticket = db_client.post(
        "/api/v1/tickets",
        json={"title": "t", "description": "d", "location": "l"},
        headers=owner,
    ).json()["id"]
    seed._created.append(("ticket", ticket))
    db_client.patch(
        f"/api/v1/tickets/{ticket}", json={"assetId": created.json()["id"]}, headers=sup
    )
    assert (
        db_client.delete(f"{API}/{created.json()['id']}", headers=sup).status_code
        == 409
    )


def test_vendors_linked_to_assets(
    db_client: TestClient, seed: Seeder, world: dict[str, object]
) -> None:
    _, sup = login_as(db_client, seed, Role.supervisor, department_id=world["dept"])
    _, rival = login_as(db_client, seed, Role.supervisor, department_id=world["other"])
    _, requester = login_as(db_client, seed, Role.requester)
    vendor = seed.insert("vendor", name=f"V {uuid4().hex[:8]}")
    asset = db_client.post(API, json=body(world), headers=sup)
    track(seed, asset)
    url = f"{API}/{asset.json()['id']}/vendors/{vendor}"
    seed._links.append((asset.json()["id"], vendor))

    assert db_client.put(url, headers=rival).status_code == 403
    assert db_client.put(url, headers=requester).status_code == 403
    assert db_client.put(url, headers=sup).status_code == 204
    assert db_client.put(url, headers=sup).status_code == 204  # idempotent
    unknown = db_client.put(
        f"{API}/{asset.json()['id']}/vendors/{uuid4()}", headers=sup
    )
    assert unknown.status_code == 404

    listed = db_client.get(f"{API}/{asset.json()['id']}/vendors", headers=requester)
    assert [v["id"] for v in listed.json()] == [str(vendor)]
    by_vendor = db_client.get(API, params={"vendorId": str(vendor)}, headers=requester)
    assert [a["id"] for a in by_vendor.json()["items"]] == [asset.json()["id"]]
    vendors = db_client.get(
        "/api/v1/vendors", params={"assetId": asset.json()["id"]}, headers=requester
    )
    assert [v["id"] for v in vendors.json()["items"]] == [str(vendor)]

    # A vendor with responsibilities cannot be deleted from under the assets.
    _, admin = login_as(db_client, seed, Role.admin)
    assert (
        db_client.delete(f"/api/v1/vendors/{vendor}", headers=admin).status_code == 409
    )

    assert db_client.delete(url, headers=rival).status_code == 403
    assert db_client.delete(url, headers=sup).status_code == 204
    assert db_client.delete(url, headers=sup).status_code == 404
    assert (
        db_client.get(f"{API}/{asset.json()['id']}/vendors", headers=sup).json() == []
    )
