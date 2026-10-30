import asyncio
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from backend.pubsub import PubSubHub, get_hub_instance
from backend.routers.tickets import _sse_generator

from .conftest import Seeder
from .test_assignments_attachments import Scene


@pytest.fixture
def scene(db_client: TestClient, seed: Seeder) -> Scene:
    return Scene(db_client, seed)


async def _always() -> bool:
    return True


async def _never() -> bool:
    return False


def test_stream_frames_events() -> None:
    async def run() -> list[str]:
        hub, ticket = PubSubHub(), uuid4()
        gen = _sse_generator(ticket, hub, _always)
        chunks = [await anext(gen)]
        await hub.publish(ticket, {"event": "comment", "data": {"body": "hi"}})
        chunks.append(await anext(gen))
        await gen.aclose()
        return chunks

    connected, comment = asyncio.run(run())
    assert connected.startswith("event: connected\n")
    assert comment == 'event: comment\ndata: {"body": "hi"}\n\n'


def test_slow_subscriber_is_told_to_resync() -> None:
    async def run() -> dict:
        hub, ticket = PubSubHub(), uuid4()
        q = hub.subscribe(ticket)
        for i in range(300):  # queue holds 256
            await hub.publish(ticket, {"event": "comment", "data": {"n": i}})
        return q.get_nowait()

    assert asyncio.run(run())["event"] == "resync"


def test_stream_closes_when_access_is_lost() -> None:
    async def run() -> list[str]:
        hub, ticket = PubSubHub(), uuid4()
        return [c async for c in _sse_generator(ticket, hub, _never, 0.01)]

    chunks = asyncio.run(run())
    assert chunks[-1] == "event: closed\ndata: {}\n\n"


def test_stream_ends_when_ticket_is_deleted() -> None:
    async def run() -> list[str]:
        hub, ticket = PubSubHub(), uuid4()
        gen = _sse_generator(ticket, hub, _always)
        await anext(gen)
        await hub.publish(ticket, {"event": "deleted", "data": {}})
        return [c async for c in gen]

    chunks = asyncio.run(run())
    assert chunks == ["event: deleted\ndata: {}\n\n"]


def _drain(q: asyncio.Queue) -> list[str]:
    events = []
    while not q.empty():
        events.append(q.get_nowait()["event"])
    return events


def test_assignment_changes_are_published(scene: Scene, db_client: TestClient) -> None:
    person, _ = scene.assignee()
    hub = get_hub_instance()
    q = hub.subscribe(UUID(scene.ticket))
    try:
        assignment = scene.assign(person).json()["id"]
        assert _drain(q) == ["assignment", "status"]

        db_client.delete(f"{scene.url}/assignments/{assignment}", headers=scene.sup)
        assert _drain(q) == ["assignment", "status"]
    finally:
        hub.unsubscribe(UUID(scene.ticket), q)


def test_second_assignee_publishes_no_status_change(scene: Scene) -> None:
    first, _ = scene.assignee()
    second, _ = scene.assignee()
    scene.assign(first)
    hub = get_hub_instance()
    q = hub.subscribe(UUID(scene.ticket))
    try:
        scene.assign(second)
        assert _drain(q) == ["assignment"]
    finally:
        hub.unsubscribe(UUID(scene.ticket), q)


def test_deleting_a_ticket_is_published(scene: Scene, db_client: TestClient) -> None:
    hub = get_hub_instance()
    q = hub.subscribe(UUID(scene.ticket))
    try:
        assert db_client.delete(scene.url, headers=scene.admin).status_code == 204
        assert _drain(q) == ["deleted"]
    finally:
        hub.unsubscribe(UUID(scene.ticket), q)
