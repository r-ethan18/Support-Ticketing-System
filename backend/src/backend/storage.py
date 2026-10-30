"""Where attachment files live.

Files go to an S3-compatible bucket (Garage in the cluster); Postgres only keeps
the object key and metadata. Routes depend on `ObjectStore`, not on the S3
client, so tests swap in an in-memory store.
"""

import asyncio
import io
import logging
from typing import Annotated, Protocol

from fastapi import Depends, HTTPException, Request, status
from minio import Minio
from minio.error import S3Error

from backend.config import StorageSettings

log = logging.getLogger(__name__)


class ObjectStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> bytes | None:
        """The object's bytes, or None if it is missing."""
        ...

    async def delete(self, keys: list[str]) -> None:
        """Remove objects; missing keys are ignored."""
        ...


class S3ObjectStore:
    """Any S3 server (Garage) through the `minio` client, run in threads (it blocks)."""

    def __init__(self, settings: StorageSettings) -> None:
        self._bucket = settings.bucket
        self._client = Minio(
            settings.endpoint,
            access_key=settings.access_key,
            secret_key=settings.secret_key,
            secure=settings.secure,
            region=settings.region,
        )

    def ensure_bucket(self) -> None:
        if not self._client.bucket_exists(self._bucket):
            self._client.make_bucket(self._bucket)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(
            self._client.put_object,
            self._bucket,
            key,
            io.BytesIO(data),
            len(data),
            content_type=content_type,
        )

    def _read(self, key: str) -> bytes | None:
        try:
            response = self._client.get_object(self._bucket, key)
        except S3Error as exc:
            if exc.code in ("NoSuchKey", "NoSuchObject"):
                return None
            raise
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    async def get(self, key: str) -> bytes | None:
        return await asyncio.to_thread(self._read, key)

    def _remove(self, keys: list[str]) -> None:
        for key in keys:
            self._client.remove_object(self._bucket, key)

    async def delete(self, keys: list[str]) -> None:
        await asyncio.to_thread(self._remove, keys)


def get_object_store(request: Request) -> ObjectStore:
    """FastAPI dependency; 503 when no storage is configured."""
    store = getattr(request.app.state, "object_store", None)
    if store is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="File storage is not configured",
        )
    return store


ObjectStoreDep = Annotated[ObjectStore, Depends(get_object_store)]


def get_optional_object_store(request: Request) -> ObjectStore | None:
    return getattr(request.app.state, "object_store", None)


OptionalObjectStoreDep = Annotated[
    ObjectStore | None, Depends(get_optional_object_store)
]


async def discard_objects(store: ObjectStore | None, keys: list[str]) -> None:
    """Best-effort cleanup once the rows pointing at `keys` are gone.

    A failure only leaves orphaned objects behind, so it must not fail the
    request that already succeeded.
    """
    if store is None or not keys:
        return
    try:
        await store.delete(keys)
    except Exception:
        log.exception("Could not delete %d attachment object(s)", len(keys))
