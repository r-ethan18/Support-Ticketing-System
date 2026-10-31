from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.schemas.enums import Role

from .conftest import Seeder, login_as

API = "/api/v1/tickets"
NEW = {"title": "Leak", "description": "Water on floor", "location": "Block A"}


@pytest.fixture
def org(seed: Seeder) -> dict[str, object]:
    tag = uuid4().hex[:6]
    cat = seed.insert("category", name=f"Cat {tag}")
    dept = seed.insert("department", name=f"Dept {tag}")
    other = seed.insert("department", name=f"Other {tag}")
    return {
        "dept": dept,
        "other": other,
        "asset": seed.insert(
            "asset", name=f"A {tag}", department_id=dept, category_id=cat
        ),
        "other_asset": seed.insert(
            "asset", name=f"B {tag}", department_id=other, category_id=cat
        ),
    }


def make_ticket(client: TestClient, headers: dict[str, str], seed: Seeder, **extra):
    response = client.post(API, json=NEW | extra, headers=headers)
    assert response.status_code == 201, response.text
    seed._created.append(("ticket", response.json()["id"]))
    return response.json()


def test_requester_creates_open_ticket_with_history(
    db_client: TestClient, seed: Seeder
) -> None:
    me, headers = login_as(db_client, seed, Role.requester)
    ticket = make_ticket(db_client, headers, seed, priority="high")
    assert ticket["status"] == "open"
    assert ticket["priority"] == "high"
    assert ticket["requesterId"] == str(me)
    assert ticket["assetId"] is None
    assert ticket["closedAt"] is None

    history = db_client.get(f"{API}/{ticket['id']}/status-history", headers=headers)
    assert [(h["fromStatus"], h["toStatus"]) for h in history.json()] == [
        (None, "open")
    ]


def test_priority_defaults_to_medium(db_client: TestClient, seed: Seeder) -> None:
    _, headers = login_as(db_client, seed, Role.requester)
    assert make_ticket(db_client, headers, seed)["priority"] == "medium"


@pytest.mark.parametrize("role", [Role.assignee, Role.supervisor])
def test_only_requesters_create(
    db_client: TestClient, seed: Seeder, role: Role
) -> None:
    _, headers = login_as(db_client, seed, role)
    assert db_client.post(API, json=NEW, headers=headers).status_code == 403


def test_visibility_per_role(
    db_client: TestClient, seed: Seeder, org: dict[str, object]
) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    _, stranger = login_as(db_client, seed, Role.requester)
    _, supervisor = login_as(
        db_client, seed, Role.supervisor, department_id=org["dept"]
    )
    _, other_supervisor = login_as(
        db_client, seed, Role.supervisor, department_id=org["other"]
    )
    _, admin = login_as(db_client, seed, Role.admin)
    _, assignee = login_as(db_client, seed, Role.assignee)

    ticket = make_ticket(db_client, owner, seed)
    url = f"{API}/{ticket['id']}"

    def sees(headers: dict[str, str]) -> bool:
        listed = db_client.get(API, params={"limit": 100}, headers=headers)
        in_list = ticket["id"] in [t["id"] for t in listed.json()["items"]]
        direct = db_client.get(url, headers=headers).status_code == 200
        assert in_list == direct
        return direct

    # No asset yet: it sits in every supervisor's triage queue.
    assert sees(owner) and sees(admin) and sees(supervisor) and sees(other_supervisor)
    assert not sees(stranger)
    assert not sees(assignee)

    # Once a supervisor files it under their department's asset, others lose it.
    patched = db_client.patch(
        url, json={"assetId": str(org["asset"])}, headers=supervisor
    )
    assert patched.status_code == 200, patched.text
    assert sees(supervisor) and sees(owner) and sees(admin)
    assert not sees(other_supervisor)


def test_assignee_sees_only_current_assignments(
    db_client: TestClient, seed: Seeder
) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    assignee_id, assignee = login_as(db_client, seed, Role.assignee)
    ticket = make_ticket(db_client, owner, seed)
    row = seed.conn.execute(
        "INSERT INTO ticket_assignment (ticket_id, assignee_id) VALUES (%s, %s)"
        " RETURNING id",
        (ticket["id"], assignee_id),
    ).fetchone()
    url = f"{API}/{ticket['id']}"
    assert db_client.get(url, headers=assignee).status_code == 200
    seed.conn.execute(
        "UPDATE ticket_assignment SET unassigned_at = now() WHERE id = %s", (row[0],)
    )
    assert db_client.get(url, headers=assignee).status_code == 404


def test_unknown_ticket_404(db_client: TestClient, seed: Seeder) -> None:
    _, headers = login_as(db_client, seed, Role.admin)
    assert db_client.get(f"{API}/{uuid4()}", headers=headers).status_code == 404


def test_list_filters_search_and_sort(db_client: TestClient, seed: Seeder) -> None:
    _, headers = login_as(db_client, seed, Role.requester)
    tag = uuid4().hex
    low = make_ticket(db_client, headers, seed, title=f"{tag} low", priority="low")
    crit = make_ticket(
        db_client, headers, seed, title=f"{tag} crit", priority="critical"
    )
    make_ticket(db_client, headers, seed, title="unrelated")

    found = db_client.get(API, params={"q": tag, "sortBy": "priority"}, headers=headers)
    assert [t["id"] for t in found.json()["items"]] == [crit["id"], low["id"]]
    asc = db_client.get(
        API, params={"q": tag, "sortBy": "priority", "order": "asc"}, headers=headers
    )
    assert [t["id"] for t in asc.json()["items"]] == [low["id"], crit["id"]]

    only_low = db_client.get(
        API, params={"q": tag, "priority": ["low"], "status": ["open"]}, headers=headers
    )
    assert [t["id"] for t in only_low.json()["items"]] == [low["id"]]
    assert only_low.json()["total"] == 1

    page = db_client.get(
        API, params={"q": tag, "limit": 1, "offset": 1}, headers=headers
    )
    assert page.json()["total"] == 2
    assert len(page.json()["items"]) == 1


def test_supervisor_updates_and_closes_with_history(
    db_client: TestClient, seed: Seeder, org: dict[str, object]
) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    sup_id, supervisor = login_as(
        db_client, seed, Role.supervisor, department_id=org["dept"]
    )
    url = f"{API}/{make_ticket(db_client, owner, seed)['id']}"

    working = db_client.patch(
        url,
        json={
            "status": "in_progress",
            "priority": "critical",
            "supervisorId": str(sup_id),
            "assetId": str(org["asset"]),
        },
        headers=supervisor,
    )
    assert working.status_code == 200, working.text
    assert working.json()["supervisorId"] == str(sup_id)

    closed = db_client.patch(url, json={"status": "closed"}, headers=supervisor)
    assert closed.json()["status"] == "closed"
    assert closed.json()["closedAt"] is not None

    history = db_client.get(f"{url}/status-history", headers=owner).json()
    assert [(h["fromStatus"], h["toStatus"]) for h in history] == [
        (None, "open"),
        ("open", "in_progress"),
        ("in_progress", "closed"),
    ]
    assert history[-1]["changedById"] == str(sup_id)

    # Closed tickets are frozen.
    again = db_client.patch(url, json={"priority": "low"}, headers=supervisor)
    assert again.status_code == 409


def test_patch_validates_references(db_client: TestClient, seed: Seeder) -> None:
    owner_id, owner = login_as(db_client, seed, Role.requester)
    _, admin = login_as(db_client, seed, Role.admin)
    url = f"{API}/{make_ticket(db_client, owner, seed)['id']}"
    assert (
        db_client.patch(url, json={"assetId": str(uuid4())}, headers=admin).status_code
        == 422
    )
    # supervisorId must be a supervisor, not just any person.
    assert (
        db_client.patch(
            url, json={"supervisorId": str(owner_id)}, headers=admin
        ).status_code
        == 422
    )


def test_requester_can_edit_and_close_own_open_ticket(
    db_client: TestClient, seed: Seeder
) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    url = f"{API}/{make_ticket(db_client, owner, seed)['id']}"

    edited = db_client.patch(
        url, json={"title": "Bigger leak", "priority": "high"}, headers=owner
    )
    assert edited.status_code == 200
    assert edited.json()["title"] == "Bigger leak"

    for forbidden in (
        {"assetId": str(uuid4())},
        {"supervisorId": str(uuid4())},
        {"status": "resolved"},
    ):
        assert db_client.patch(url, json=forbidden, headers=owner).status_code == 403

    closed = db_client.patch(url, json={"status": "closed"}, headers=owner)
    assert closed.status_code == 200
    assert closed.json()["closedAt"] is not None
    assert db_client.patch(url, json={"title": "x"}, headers=owner).status_code == 409


def test_requester_cannot_touch_others_or_edit_after_assignment(
    db_client: TestClient, seed: Seeder
) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    _, stranger = login_as(db_client, seed, Role.requester)
    _, admin = login_as(db_client, seed, Role.admin)
    url = f"{API}/{make_ticket(db_client, owner, seed)['id']}"

    assert (
        db_client.patch(url, json={"title": "x"}, headers=stranger).status_code == 404
    )

    db_client.patch(url, json={"status": "assigned"}, headers=admin)
    assert db_client.patch(url, json={"title": "x"}, headers=owner).status_code == 409


def test_assignee_can_mark_resolved_and_requester_can_close(
    db_client: TestClient, seed: Seeder
) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    assignee_id, assignee = login_as(db_client, seed, Role.assignee)
    ticket = make_ticket(db_client, owner, seed)
    seed.conn.execute(
        "INSERT INTO ticket_assignment (ticket_id, assignee_id) VALUES (%s, %s)",
        (ticket["id"], assignee_id),
    )
    url = f"{API}/{ticket['id']}"

    # Assignee cannot edit ticket metadata (forbidden)
    bad_edit = db_client.patch(url, json={"title": "Hacked"}, headers=assignee)
    assert bad_edit.status_code == 403

    # Assignee cannot directly close ticket (forbidden)
    bad_close = db_client.patch(url, json={"status": "closed"}, headers=assignee)
    assert bad_close.status_code == 403

    # Assignee can mark ticket as resolved
    resolved = db_client.patch(url, json={"status": "resolved"}, headers=assignee)
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"

    # Once resolved, requestee (owner) can approve and close the ticket
    closed = db_client.patch(url, json={"status": "closed"}, headers=owner)
    assert closed.status_code == 200
    assert closed.json()["status"] == "closed"
    assert closed.json()["closedAt"] is not None

    # After closure, assignee cannot update
    conflict = db_client.patch(url, json={"status": "resolved"}, headers=assignee)
    assert conflict.status_code == 409


def test_only_admin_deletes(db_client: TestClient, seed: Seeder) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    _, admin = login_as(db_client, seed, Role.admin)
    url = f"{API}/{make_ticket(db_client, owner, seed)['id']}"
    assert db_client.delete(url, headers=owner).status_code == 403
    assert db_client.delete(url, headers=admin).status_code == 204
    assert db_client.get(url, headers=admin).status_code == 404
    assert db_client.delete(url, headers=admin).status_code == 404


def test_supervisor_or_admin_can_reopen_closed_ticket(
    db_client: TestClient, seed: Seeder
) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    _, supervisor = login_as(db_client, seed, Role.supervisor)
    ticket_id = make_ticket(db_client, owner, seed)["id"]
    url = f"{API}/{ticket_id}"

    # Close ticket
    closed = db_client.patch(url, json={"status": "closed"}, headers=supervisor)
    assert closed.status_code == 200
    assert closed.json()["status"] == "closed"
    assert closed.json()["closedAt"] is not None

    # Requester cannot reopen (403)
    assert (
        db_client.patch(url, json={"status": "open"}, headers=owner).status_code == 403
    )

    # Supervisor reopens ticket
    reopened = db_client.patch(url, json={"status": "open"}, headers=supervisor)
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "open"
    assert reopened.json()["closedAt"] is None

    # Check history logs from closed to open
    history = db_client.get(f"{url}/status-history", headers=owner).json()
    assert (history[-1]["fromStatus"], history[-1]["toStatus"]) == ("closed", "open")


def test_reopen_requested_status_and_filtering(
    db_client: TestClient, seed: Seeder
) -> None:
    _, owner = login_as(db_client, seed, Role.requester)
    _, admin = login_as(db_client, seed, Role.admin)
    ticket_id = make_ticket(db_client, owner, seed)["id"]
    url = f"{API}/{ticket_id}"

    # Close ticket
    db_client.patch(url, json={"status": "closed"}, headers=owner)
    ticket = db_client.get(url, headers=owner).json()
    assert ticket["status"] == "closed"
    assert ticket["reopenRequested"] is False

    # Requester posts reopen request in chats
    res = db_client.post(
        f"{url}/comments",
        json={"body": "[Reopen Requested]: Please look into this again"},
        headers=owner,
    )
    assert res.status_code == 201

    # Now ticket has reopenRequested = True
    ticket = db_client.get(url, headers=owner).json()
    assert ticket["status"] == "closed"
    assert ticket["reopenRequested"] is True

    # Filter by reopen_requested
    filtered = db_client.get(f"{API}?status=reopen_requested", headers=admin).json()
    assert any(t["id"] == ticket_id for t in filtered["items"])

    # Once supervisor/admin approves and reopens, reopenRequested becomes False
    db_client.patch(url, json={"status": "open"}, headers=admin)
    ticket = db_client.get(url, headers=owner).json()
    assert ticket["status"] == "open"
    assert ticket["reopenRequested"] is False
    filtered_after = db_client.get(
        f"{API}?status=reopen_requested", headers=admin
    ).json()
    assert not any(t["id"] == ticket_id for t in filtered_after["items"])
