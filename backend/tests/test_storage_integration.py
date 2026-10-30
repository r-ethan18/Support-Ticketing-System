"""Attachments against a real S3 server (Garage in CI).

Skipped unless `S3_ENDPOINT` is set; with `REQUIRE_STORAGE` set (CI) a missing
or unreachable server fails instead.
"""

import asyncio
import os
from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from minio.error import S3Error
from urllib3.exceptions import HTTPError

from backend.config import get_settings
from backend.main import create_app
from backend.schemas.enums import Role
from backend.storage import S3ObjectStore

from .conftest import Seeder, login_as

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def storage_unavailable(reason: str) -> None:
    if os.environ.get("REQUIRE_STORAGE"):
        pytest.fail(reason)
    pytest.skip(reason)


@pytest.fixture
def s3() -> S3ObjectStore:
    settings = get_settings().storage
    if not settings.enabled:
        storage_unavailable("S3_ENDPOINT is not set")
    store = S3ObjectStore(settings)
    try:
        store.ensure_bucket()
    except (HTTPError, S3Error, OSError) as exc:
        storage_unavailable(f"S3 not reachable ({exc})")
    return store


def test_object_store_round_trip(s3: S3ObjectStore) -> None:
    async def run() -> None:
        key = f"tests/{uuid4()}"
        await s3.put(key, PNG, "image/png")
        assert await s3.get(key) == PNG
        await s3.delete([key, f"tests/{uuid4()}"])  # deleting a missing key is fine
        assert await s3.get(key) is None

    asyncio.run(run())


@pytest.fixture
def real_client(s3: S3ObjectStore, seed: Seeder) -> Iterator[TestClient]:
    """The app wired to the real object store (no dependency overrides)."""
    with TestClient(create_app()) as c:
        yield c


def test_upload_download_and_cleanup_through_the_api(
    real_client: TestClient, seed: Seeder, s3: S3ObjectStore
) -> None:
    _, owner = login_as(real_client, seed, Role.requester)
    _, admin = login_as(real_client, seed, Role.admin)
    ticket = real_client.post(
        "/api/v1/tickets",
        json={"title": "Leak", "description": "Water", "location": "Block A"},
        headers=owner,
    ).json()["id"]
    seed._created.append(("ticket", ticket))

    uploaded = real_client.post(
        f"/api/v1/tickets/{ticket}/attachments",
        data={"kind": "issue_evidence"},
        files={"file": ("leak.png", PNG, "image/png")},
        headers=owner,
    )
    assert uploaded.status_code == 201, uploaded.text
    content = uploaded.json()["storageUrl"]
    got = real_client.get(content, headers=owner)
    assert got.status_code == 200
    assert got.content == PNG

    assert (
        real_client.delete(f"/api/v1/tickets/{ticket}", headers=admin).status_code
        == 204
    )
    assert real_client.get(content, headers=admin).status_code == 404
    leftovers = s3._client.list_objects(s3._bucket, prefix=f"tickets/{ticket}/")
    assert list(leftovers) == []
