from uuid import uuid4

from fastapi.testclient import TestClient

from backend.schemas.enums import Role

from .conftest import Seeder, login_as

API = "/api/v1/tickets"


def test_chat_between_requester_supervisor_and_assignee(
    db_client: TestClient, seed: Seeder
) -> None:
    owner_id, owner = login_as(db_client, seed, Role.requester)
    sup_id, supervisor = login_as(db_client, seed, Role.supervisor)
    assignee_id, assignee = login_as(db_client, seed, Role.assignee)
    ticket = db_client.post(
        API,
        json={"title": "t", "description": "d", "location": "l"},
        headers=owner,
    ).json()["id"]
    seed._created.append(("ticket", ticket))
    url = f"{API}/{ticket}/comments"
    assert (
        db_client.post(
            f"{API}/{ticket}/assignments",
            json={"assigneeId": str(assignee_id)},
            headers=supervisor,
        ).status_code
        == 201
    )

    for who, headers, text in (
        (owner_id, owner, "It is leaking"),
        (sup_id, supervisor, "Sending someone"),
        (assignee_id, assignee, "On my way"),
    ):
        response = db_client.post(url, json={"body": text}, headers=headers)
        assert response.status_code == 201, response.text
        assert response.json()["authorId"] == str(who)
        assert response.json()["ticketId"] == ticket

    for headers in (owner, supervisor, assignee):
        thread = db_client.get(url, headers=headers).json()
        assert [c["body"] for c in thread] == [
            "It is leaking",
            "Sending someone",
            "On my way",
        ]


def test_outsiders_cannot_read_or_post(db_client: TestClient, seed: Seeder) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    _, stranger = login_as(db_client, seed, Role.requester)
    _, assignee = login_as(db_client, seed, Role.assignee)
    ticket = db_client.post(
        API, json={"title": "t", "description": "d", "location": "l"}, headers=owner
    ).json()["id"]
    seed._created.append(("ticket", ticket))
    url = f"{API}/{ticket}/comments"
    for headers in (stranger, assignee):
        assert db_client.get(url, headers=headers).status_code == 404
        assert (
            db_client.post(url, json={"body": "hi"}, headers=headers).status_code == 404
        )


def test_validation_unknown_ticket_and_closed(
    db_client: TestClient, seed: Seeder
) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    ticket = db_client.post(
        API, json={"title": "t", "description": "d", "location": "l"}, headers=owner
    ).json()["id"]
    seed._created.append(("ticket", ticket))
    url = f"{API}/{ticket}/comments"

    assert db_client.post(url, json={"body": ""}, headers=owner).status_code == 422
    assert db_client.post(url, json={}, headers=owner).status_code == 422
    missing = db_client.get(f"{API}/{uuid4()}/comments", headers=owner)
    assert missing.status_code == 404

    db_client.post(url, json={"body": "before close"}, headers=owner)
    db_client.patch(f"{API}/{ticket}", json={"status": "closed"}, headers=owner)
    assert db_client.post(url, json={"body": "after"}, headers=owner).status_code == 409
    # The thread stays readable.
    assert len(db_client.get(url, headers=owner).json()) == 1


def test_admin_can_follow_any_thread(db_client: TestClient, seed: Seeder) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    _, admin = login_as(db_client, seed, Role.admin)
    ticket = db_client.post(
        API, json={"title": "t", "description": "d", "location": "l"}, headers=owner
    ).json()["id"]
    seed._created.append(("ticket", ticket))
    url = f"{API}/{ticket}/comments"
    assert (
        db_client.post(url, json={"body": "admin here"}, headers=admin).status_code
        == 201
    )
    assert db_client.get(url, headers=owner).json()[0]["body"] == "admin here"


def test_ticket_sse_stream_and_realtime_updates(
    db_client: TestClient, seed: Seeder
) -> None:
    from backend.pubsub import get_hub_instance

    _owner_id, owner = login_as(db_client, seed, Role.requester)
    _, stranger = login_as(db_client, seed, Role.requester)

    ticket = db_client.post(
        API,
        json={"title": "SSE test", "description": "d", "location": "l"},
        headers=owner,
    ).json()["id"]
    seed._created.append(("ticket", ticket))

    # Stranger cannot access ticket stream
    stranger_stream = db_client.get(f"{API}/{ticket}/stream", headers=stranger)
    assert stranger_stream.status_code == 404

    # Owner can connect to stream and gets initial connected event
    hub = get_hub_instance()
    from uuid import UUID

    q = hub.subscribe(UUID(ticket))
    try:
        # Create a comment
        res = db_client.post(
            f"{API}/{ticket}/comments", json={"body": "live comment"}, headers=owner
        )
        assert res.status_code == 201

        # Check queue has the comment event
        assert not q.empty()
        event = q.get_nowait()
        assert event["event"] == "comment"
        assert event["data"]["body"] == "live comment"

        # Update status (requester can close own ticket)
        res = db_client.patch(
            f"{API}/{ticket}", json={"status": "closed"}, headers=owner
        )
        assert res.status_code == 200

        # Check queue has status event
        assert not q.empty()
        status_event = q.get_nowait()
        assert status_event["event"] == "status"
        assert status_event["data"]["status"] == "closed"
    finally:
        hub.unsubscribe(UUID(ticket), q)


def test_requester_can_post_reopen_request_comment_on_closed_ticket(
    db_client: TestClient, seed: Seeder
) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    ticket = db_client.post(
        API, json={"title": "t", "description": "d", "location": "l"}, headers=owner
    ).json()["id"]
    seed._created.append(("ticket", ticket))
    url = f"{API}/{ticket}/comments"

    # Close ticket
    db_client.patch(f"{API}/{ticket}", json={"status": "closed"}, headers=owner)

    # Ordinary comment fails with 409
    assert (
        db_client.post(url, json={"body": "regular chat"}, headers=owner).status_code
        == 409
    )

    # Reopen request comment succeeds with 201
    reopen_msg = "[Reopen Requested]: Issue recurring, please inspect again."
    res = db_client.post(url, json={"body": reopen_msg}, headers=owner)
    assert res.status_code == 201
    assert res.json()["body"] == reopen_msg
