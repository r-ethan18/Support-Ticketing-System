import asyncio
from types import SimpleNamespace

import pytest
from minio.error import S3Error

from backend import storage
from backend.config import StorageSettings, get_settings
from backend.storage import S3ObjectStore, discard_objects


class FakeMinio:
    def __init__(self, *args, **kwargs) -> None:
        self.args, self.kwargs = args, kwargs
        self.buckets: set[str] = set()
        self.objects: dict[str, bytes] = {}
        self.removed: list[str] = []

    def bucket_exists(self, bucket):
        return bucket in self.buckets

    def make_bucket(self, bucket):
        self.buckets.add(bucket)

    def put_object(self, bucket, key, stream, length, content_type):
        self.objects[key] = stream.read()
        assert length == len(self.objects[key])

    def get_object(self, bucket, key):
        if key not in self.objects:
            raise S3Error(
                code="NoSuchKey",
                message="missing",
                resource=key,
                request_id="req",
                host_id="host",
                response=None,
            )
        return SimpleNamespace(
            read=lambda: self.objects[key],
            close=lambda: None,
            release_conn=lambda: None,
        )

    def remove_object(self, bucket, key):
        self.removed.append(key)
        self.objects.pop(key, None)


@pytest.fixture
def s3(monkeypatch: pytest.MonkeyPatch) -> S3ObjectStore:
    monkeypatch.setattr(storage, "Minio", FakeMinio)
    return S3ObjectStore(StorageSettings(endpoint="garage:3900", bucket="b"))


def test_storage_settings_come_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    assert not get_settings().storage.enabled
    monkeypatch.setenv("S3_ENDPOINT", "garage:3900")
    monkeypatch.setenv("S3_ACCESS_KEY", "ak")
    monkeypatch.setenv("S3_SECRET_KEY", "sk")
    monkeypatch.setenv("S3_BUCKET", "files")
    monkeypatch.setenv("S3_SECURE", "true")
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "5")
    get_settings.cache_clear()
    settings = get_settings().storage
    assert settings == StorageSettings(
        "garage:3900", "ak", "sk", "files", True, "garage", 5
    )
    assert settings.enabled


def test_ensure_bucket_creates_it_once(s3: S3ObjectStore) -> None:
    s3.ensure_bucket()
    s3.ensure_bucket()
    assert s3._client.buckets == {"b"}


def test_put_get_delete_round_trip(s3: S3ObjectStore) -> None:
    async def run() -> None:
        await s3.put("k", b"data", "image/png")
        assert await s3.get("k") == b"data"
        await s3.delete(["k"])
        assert await s3.get("k") is None

    asyncio.run(run())


def test_discard_objects_swallows_failures() -> None:
    class Broken:
        async def delete(self, keys):
            raise OSError("storage is down")

    asyncio.run(discard_objects(Broken(), ["k"]))  # type: ignore[arg-type]
    asyncio.run(discard_objects(None, ["k"]))
