from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.schemas.enums import Role

from .conftest import Seeder, login_as

API = "/api/v1"


@pytest.fixture
def world(seed: Seeder) -> dict[str, object]:
    tag = uuid4().hex[:8]
    vendor = seed.insert("vendor", name=f"Vendor {tag}")
    dept = seed.insert("department", name=f"Dept {tag}")
    other_dept = seed.insert("department", name=f"Other {tag}")
    cat = seed.insert("category", name=f"Cat {tag}")
    asset = seed.insert(
        "asset", name=f"Asset {tag}", department_id=dept, category_id=cat
    )
    seed.insert("asset", name=f"Pump {tag}", department_id=other_dept, category_id=cat)
    return {
        "tag": tag,
        "vendor": vendor,
        "dept": dept,
        "other_dept": other_dept,
        "cat": cat,
        "asset": asset,
    }


@pytest.mark.parametrize("path", ["vendors", "departments", "categories", "assets"])
def test_requires_token(db_client: TestClient, path: str) -> None:
    assert db_client.get(f"{API}/{path}").status_code == 401


@pytest.mark.parametrize(
    ("path", "key"),
    [
        ("vendors", "vendor"),
        ("departments", "dept"),
        ("categories", "cat"),
        ("assets", "asset"),
    ],
)
def test_list_and_get(
    db_client: TestClient, seed: Seeder, world: dict[str, object], path: str, key: str
) -> None:
    _, headers = login_as(db_client, seed, Role.requester)
    listed = db_client.get(
        f"{API}/{path}", params={"q": world["tag"], "limit": 100}, headers=headers
    )
    assert listed.status_code == 200, listed.text
    ids = [item["id"] for item in listed.json()["items"]]
    assert str(world[key]) in ids
    fetched = db_client.get(f"{API}/{path}/{world[key]}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["id"] == str(world[key])


@pytest.mark.parametrize("path", ["vendors", "departments", "categories", "assets"])
def test_unknown_id_is_404(db_client: TestClient, seed: Seeder, path: str) -> None:
    _, headers = login_as(db_client, seed, Role.requester)
    assert db_client.get(f"{API}/{path}/{uuid4()}", headers=headers).status_code == 404


def test_asset_filters_and_pagination(
    db_client: TestClient, seed: Seeder, world: dict[str, object]
) -> None:
    _, headers = login_as(db_client, seed, Role.requester)
    by_dept = db_client.get(
        f"{API}/assets", params={"departmentId": str(world["dept"])}, headers=headers
    ).json()
    assert [a["id"] for a in by_dept["items"]] == [str(world["asset"])]
    assert by_dept["total"] == 1

    by_cat = db_client.get(
        f"{API}/assets",
        params={"categoryId": str(world["cat"]), "limit": 1, "offset": 1},
        headers=headers,
    ).json()
    assert by_cat["total"] == 2
    assert len(by_cat["items"]) == 1
    assert by_cat["limit"] == 1
    assert by_cat["offset"] == 1


def test_search_treats_wildcards_literally(
    db_client: TestClient, seed: Seeder, world: dict[str, object]
) -> None:
    _, headers = login_as(db_client, seed, Role.requester)
    response = db_client.get(f"{API}/assets", params={"q": "%"}, headers=headers)
    assert response.json()["total"] == 0
