from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.config import get_settings
from backend.schemas.enums import Role
from backend.storage import get_object_store

from .conftest import Seeder, login_as

API = "/api/v1/tickets"
NEW = {"title": "Leak", "description": "Water", "location": "Block A"}


class Scene:
    """A department, its asset, a supervisor, an owner and one ticket."""

    def __init__(self, client: TestClient, seed: Seeder) -> None:
        self.client = client
        self.seed = seed
        tag = uuid4().hex[:6]
        self.cat = seed.insert("category", name=f"Cat {tag}")
        self.dept = seed.insert("department", name=f"Dept {tag}")
        self.asset = seed.insert(
            "asset", name=f"A {tag}", department_id=self.dept, category_id=self.cat
        )
        self.owner_id, self.owner = login_as(client, seed, Role.requester)
        self.sup_id, self.sup = login_as(
            client, seed, Role.supervisor, department_id=self.dept
        )
        _, self.admin = login_as(client, seed, Role.admin)
        response = client.post(API, json=NEW, headers=self.owner)
        self.ticket = response.json()["id"]
        seed._created.append(("ticket", self.ticket))
        self.url = f"{API}/{self.ticket}"

    def assignee(self, *, responsible: bool = True):
        """An assignee employed by a new vendor, linked to the asset by default."""
        vendor = self.seed.insert("vendor", name=f"V {uuid4().hex[:8]}")
        person_id, headers = login_as(
            self.client, self.seed, Role.assignee, vendor_id=vendor
        )
        if responsible:
            self.seed.link_vendor(self.asset, vendor)
        return person_id, headers

    def assign(self, assignee_id, headers=None):
        return self.client.post(
            f"{self.url}/assignments",
            json={"assigneeId": str(assignee_id)},
            headers=headers or self.sup,
        )

    def status(self) -> str:
        return self.client.get(self.url, headers=self.admin).json()["status"]


@pytest.fixture
def scene(db_client: TestClient, seed: Seeder) -> Scene:
    return Scene(db_client, seed)


def test_assign_multiple_and_list_history(scene: Scene, db_client: TestClient) -> None:
    first, _ = scene.assignee()
    second, _ = scene.assignee()
    a = scene.assign(first)
    assert a.status_code == 201, a.text
    assert a.json()["unassignedAt"] is None
    assert scene.assign(second).status_code == 201
    assert scene.status() == "assigned"

    listed = db_client.get(f"{scene.url}/assignments", headers=scene.owner)
    assert [x["assigneeId"] for x in listed.json()] == [str(first), str(second)]

    history = db_client.get(f"{scene.url}/status-history", headers=scene.admin).json()
    assert [h["toStatus"] for h in history] == ["open", "assigned"]


def test_duplicate_active_assignment_conflicts(scene: Scene) -> None:
    person, _ = scene.assignee()
    assert scene.assign(person).status_code == 201
    assert scene.assign(person).status_code == 409


def test_assign_rejects_non_assignees_and_unlinked_vendor(scene: Scene) -> None:
    assert scene.assign(scene.owner_id).status_code == 422
    assert scene.assign(uuid4()).status_code == 422
    # Before the ticket has an asset, anyone with the assignee role will do...
    generalist, _ = scene.assignee(responsible=False)
    # ...but once it has one, the assignee's vendor must be responsible for it.
    scene.client.patch(scene.url, json={"assetId": str(scene.asset)}, headers=scene.sup)
    assert scene.assign(generalist).status_code == 422
    responsible, _ = scene.assignee()
    assert scene.assign(responsible).status_code == 201


def test_only_supervisors_assign_and_unknown_ticket(
    scene: Scene, db_client: TestClient
) -> None:
    person, assignee = scene.assignee()
    assert scene.assign(person, scene.owner).status_code == 403
    assert scene.assign(person, assignee).status_code == 403
    assert scene.assign(person, scene.admin).status_code == 201
    missing = db_client.post(
        f"{API}/{uuid4()}/assignments",
        json={"assigneeId": str(person)},
        headers=scene.admin,
    )
    assert missing.status_code == 404


def test_cannot_assign_closed_ticket(scene: Scene, db_client: TestClient) -> None:
    person, _ = scene.assignee()
    db_client.patch(scene.url, json={"status": "closed"}, headers=scene.sup)
    assert scene.assign(person).status_code == 409


def test_unassign_keeps_history_and_reopens_when_last_leaves(
    scene: Scene, db_client: TestClient
) -> None:
    first, first_headers = scene.assignee()
    second, _ = scene.assignee()
    a1 = scene.assign(first).json()["id"]
    a2 = scene.assign(second).json()["id"]

    assert (
        db_client.delete(f"{scene.url}/assignments/{a1}", headers=scene.sup).status_code
        == 204
    )
    assert scene.status() == "assigned"  # second is still on it
    # The unassigned person loses access.
    assert db_client.get(scene.url, headers=first_headers).status_code == 404

    assert (
        db_client.delete(f"{scene.url}/assignments/{a2}", headers=scene.sup).status_code
        == 204
    )
    assert scene.status() == "open"

    rows = db_client.get(f"{scene.url}/assignments", headers=scene.sup).json()
    assert len(rows) == 2
    assert all(r["unassignedAt"] for r in rows)

    # Already unassigned, or never on this ticket.
    assert (
        db_client.delete(f"{scene.url}/assignments/{a1}", headers=scene.sup).status_code
        == 404
    )
    assert (
        db_client.delete(
            f"{scene.url}/assignments/{uuid4()}", headers=scene.sup
        ).status_code
        == 404
    )

    # A person can be re-assigned after being unassigned.
    assert scene.assign(first).status_code == 201


def test_unassign_does_not_reopen_in_progress_ticket(
    scene: Scene, db_client: TestClient
) -> None:
    person, _ = scene.assignee()
    a = scene.assign(person).json()["id"]
    db_client.patch(scene.url, json={"status": "in_progress"}, headers=scene.sup)
    db_client.delete(f"{scene.url}/assignments/{a}", headers=scene.sup)
    assert scene.status() == "in_progress"


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def upload(
    client,
    url,
    headers,
    kind="issue_evidence",
    *,
    name="leak.png",
    data=PNG,
    content_type="image/png",
):
    return client.post(
        url,
        data={"kind": kind},
        files={"file": (name, data, content_type)},
        headers=headers,
    )


def test_requester_adds_evidence_assignee_adds_proof(
    scene: Scene, db_client: TestClient, object_store
) -> None:
    person, assignee = scene.assignee()
    scene.assign(person)
    url = f"{scene.url}/attachments"

    evidence = upload(db_client, url, scene.owner)
    assert evidence.status_code == 201, evidence.text
    body = evidence.json()
    assert body["uploadedById"] == str(scene.owner_id)
    assert body["filename"] == "leak.png"
    assert body["contentType"] == "image/png"
    assert body["sizeBytes"] == len(PNG)
    assert body["storageUrl"] == f"{url}/{body['id']}/content"
    assert len(object_store.objects) == 1

    proof = upload(db_client, url, assignee, "completion_proof", name="fixed.png")
    assert proof.status_code == 201, proof.text

    everything = db_client.get(url, headers=scene.sup).json()
    assert [a["kind"] for a in everything] == ["issue_evidence", "completion_proof"]
    only_proof = db_client.get(
        url, params={"kind": "completion_proof"}, headers=scene.owner
    )
    assert [a["id"] for a in only_proof.json()] == [proof.json()["id"]]


def test_attachment_content_is_served_to_people_who_see_the_ticket(
    scene: Scene, db_client: TestClient
) -> None:
    person, assignee = scene.assignee()
    scene.assign(person)
    created = upload(db_client, f"{scene.url}/attachments", scene.owner).json()

    for headers in (scene.owner, scene.sup, assignee, scene.admin):
        got = db_client.get(created["storageUrl"], headers=headers)
        assert got.status_code == 200
        assert got.content == PNG
        assert got.headers["content-type"] == "image/png"
        assert got.headers["content-disposition"].startswith("inline")
        assert got.headers["x-content-type-options"] == "nosniff"

    _, stranger = login_as(db_client, scene.seed, Role.requester)
    assert db_client.get(created["storageUrl"], headers=stranger).status_code == 404
    assert db_client.get(created["storageUrl"]).status_code == 401


def test_pdfs_download_as_attachments(scene: Scene, db_client: TestClient) -> None:
    created = upload(
        db_client,
        f"{scene.url}/attachments",
        scene.owner,
        name="receipt.pdf",
        data=b"%PDF-1.7 x",
        content_type="application/pdf",
    ).json()
    got = db_client.get(created["storageUrl"], headers=scene.owner)
    assert got.headers["content-disposition"].startswith("attachment")


def test_unknown_attachment_content_is_404(scene: Scene, db_client: TestClient) -> None:
    missing = f"{scene.url}/attachments/{uuid4()}/content"
    assert db_client.get(missing, headers=scene.owner).status_code == 404


def test_upload_rejects_bad_files(
    scene: Scene, db_client: TestClient, monkeypatch, object_store
) -> None:
    url = f"{scene.url}/attachments"
    html = upload(
        db_client,
        url,
        scene.owner,
        name="x.html",
        data=b"<script>",
        content_type="text/html",
    )
    assert html.status_code == 415
    assert upload(db_client, url, scene.owner, data=b"").status_code == 422

    monkeypatch.setenv("MAX_UPLOAD_BYTES", "16")
    get_settings.cache_clear()
    assert upload(db_client, url, scene.owner, data=b"x" * 17).status_code == 413
    assert upload(db_client, url, scene.owner, data=b"x" * 16).status_code == 201

    no_file = db_client.post(url, data={"kind": "issue_evidence"}, headers=scene.owner)
    assert no_file.status_code == 422
    bad_kind = db_client.post(
        url,
        data={"kind": "selfie"},
        files={"file": ("a.png", PNG, "image/png")},
        headers=scene.owner,
    )
    assert bad_kind.status_code == 422
    assert len(object_store.objects) == 1


def test_upload_filename_is_reduced_to_a_base_name(
    scene: Scene, db_client: TestClient
) -> None:
    created = upload(
        db_client, f"{scene.url}/attachments", scene.owner, name="../../etc/pass.png"
    )
    assert created.json()["filename"] == "pass.png"


def test_attachment_permissions(scene: Scene, db_client: TestClient) -> None:
    person, assignee = scene.assignee()
    scene.assign(person)
    _, stranger = login_as(db_client, scene.seed, Role.requester)
    url = f"{scene.url}/attachments"

    def post(headers, kind):
        return upload(db_client, url, headers, kind).status_code

    assert post(scene.owner, "completion_proof") == 403
    assert post(assignee, "issue_evidence") == 403
    assert post(scene.sup, "issue_evidence") == 403
    assert post(scene.sup, "completion_proof") == 403
    assert post(stranger, "issue_evidence") == 404
    assert post(scene.admin, "completion_proof") == 201


def test_no_attachments_on_closed_ticket(scene: Scene, db_client: TestClient) -> None:
    db_client.patch(scene.url, json={"status": "closed"}, headers=scene.sup)
    response = upload(db_client, f"{scene.url}/attachments", scene.owner)
    assert response.status_code == 409


def test_legacy_external_link_attachments_still_list(
    scene: Scene, db_client: TestClient
) -> None:
    scene.seed.insert(
        "ticket_attachment",
        ticket_id=scene.ticket,
        uploaded_by_id=scene.owner_id,
        kind="issue_evidence",
        storage_url="https://example.com/old.jpg",
    )
    listed = db_client.get(f"{scene.url}/attachments", headers=scene.owner).json()
    assert listed[0]["storageUrl"] == "https://example.com/old.jpg"
    assert listed[0]["filename"] is None
    content = f"{scene.url}/attachments/{listed[0]['id']}/content"
    assert db_client.get(content, headers=scene.owner).status_code == 404


def test_uploads_are_removed_with_their_ticket(
    scene: Scene, db_client: TestClient, object_store
) -> None:
    upload(db_client, f"{scene.url}/attachments", scene.owner)
    assert len(object_store.objects) == 1
    assert db_client.delete(scene.url, headers=scene.admin).status_code == 204
    assert object_store.objects == {}


def test_uploads_are_removed_with_a_deleted_requesters_closed_ticket(
    scene: Scene, db_client: TestClient, object_store
) -> None:
    upload(db_client, f"{scene.url}/attachments", scene.owner)
    db_client.patch(scene.url, json={"status": "closed"}, headers=scene.owner)
    db_client.delete(f"/api/v1/people/{scene.owner_id}", headers=scene.admin)
    assert object_store.objects == {}


def test_uploads_report_unavailable_without_storage(
    scene: Scene, db_client: TestClient
) -> None:
    del db_client.app.dependency_overrides[get_object_store]
    response = upload(db_client, f"{scene.url}/attachments", scene.owner)
    assert response.status_code == 503


def test_deleting_an_assignee_unassigns_them_and_keeps_history(
    scene: Scene, db_client: TestClient
) -> None:
    person, headers = scene.assignee()
    other, _ = scene.assignee()
    scene.assign(person)
    scene.assign(other)
    db_client.post(f"{scene.url}/comments", json={"body": "on it"}, headers=headers)
    assert scene.status() == "assigned"

    response = db_client.delete(f"/api/v1/people/{person}", headers=scene.admin)
    assert response.status_code == 204

    # Someone else is still on the ticket, so it stays assigned.
    assert scene.status() == "assigned"
    assignments = db_client.get(f"{scene.url}/assignments", headers=scene.admin).json()
    gone = next(a for a in assignments if a["assigneeId"] is None)
    assert gone["unassignedAt"] is not None
    comments = db_client.get(f"{scene.url}/comments", headers=scene.admin).json()
    assert [c["authorId"] for c in comments] == [None]


def test_deleting_the_last_assignee_reopens_the_ticket(
    scene: Scene, db_client: TestClient
) -> None:
    person, _ = scene.assignee()
    scene.assign(person)
    assert scene.status() == "assigned"

    db_client.delete(f"/api/v1/people/{person}", headers=scene.admin)

    assert scene.status() == "open"
    history = db_client.get(f"{scene.url}/status-history", headers=scene.admin).json()
    assert history[-1]["fromStatus"] == "assigned"
    assert history[-1]["toStatus"] == "open"


def test_deleting_a_requester_keeps_open_tickets_without_an_author(
    scene: Scene, db_client: TestClient
) -> None:
    person, _ = scene.assignee()
    scene.assign(person)

    response = db_client.delete(f"/api/v1/people/{scene.owner_id}", headers=scene.admin)

    assert response.status_code == 204
    ticket = db_client.get(scene.url, headers=scene.admin).json()
    assert ticket["requesterId"] is None
    assert ticket["status"] == "assigned"


def test_deleting_a_requester_removes_only_untouched_closed_tickets(
    scene: Scene, db_client: TestClient
) -> None:
    def closed_ticket() -> str:
        ticket = db_client.post(API, json=NEW, headers=scene.owner).json()["id"]
        scene.seed._created.append(("ticket", ticket))
        return ticket

    quiet, discussed = closed_ticket(), closed_ticket()
    db_client.post(
        f"{API}/{discussed}/comments", json={"body": "on it"}, headers=scene.sup
    )
    for ticket in (quiet, discussed):
        db_client.patch(
            f"{API}/{ticket}", json={"status": "closed"}, headers=scene.owner
        )

    db_client.delete(f"/api/v1/people/{scene.owner_id}", headers=scene.admin)

    assert db_client.get(f"{API}/{quiet}", headers=scene.admin).status_code == 404
    kept = db_client.get(f"{API}/{discussed}", headers=scene.admin)
    assert kept.status_code == 200
    assert kept.json()["requesterId"] is None


def test_deleting_a_supervisor_clears_ticket_supervisor(
    scene: Scene, db_client: TestClient
) -> None:
    db_client.patch(
        scene.url, json={"supervisorId": str(scene.sup_id)}, headers=scene.sup
    )
    assert db_client.get(scene.url, headers=scene.admin).json()["supervisorId"] == str(
        scene.sup_id
    )
    db_client.delete(f"/api/v1/people/{scene.sup_id}", headers=scene.admin)
    assert db_client.get(scene.url, headers=scene.admin).json()["supervisorId"] is None


def test_changing_an_assignees_role_takes_them_off_their_tickets(
    scene: Scene, db_client: TestClient
) -> None:
    person, _ = scene.assignee()
    scene.assign(person)
    response = db_client.put(
        f"/api/v1/people/{person}/role",
        json={"role": "requester"},
        headers=scene.admin,
    )
    assert response.status_code == 200
    assert scene.status() == "open"
    assignments = db_client.get(f"{scene.url}/assignments", headers=scene.admin).json()
    assert all(a["unassignedAt"] is not None for a in assignments)


def test_deleting_a_vendor_unassigns_and_demotes_its_technicians(
    scene: Scene, db_client: TestClient
) -> None:
    person, _ = scene.assignee(responsible=False)
    scene.assign(person)
    vendor = db_client.get(f"/api/v1/people/{person}", headers=scene.admin).json()[
        "vendorId"
    ]

    assert (
        db_client.delete(f"/api/v1/vendors/{vendor}", headers=scene.admin).status_code
        == 204
    )

    assert scene.status() == "open"
    demoted = db_client.get(f"/api/v1/people/{person}", headers=scene.admin).json()
    assert demoted["role"] == "requester"
    assert demoted["vendorId"] is None
    assert (
        db_client.get(f"/api/v1/vendors/{vendor}", headers=scene.admin).status_code
        == 404
    )


def test_cannot_delete_a_vendor_responsible_for_assets(
    scene: Scene, db_client: TestClient
) -> None:
    person, _ = scene.assignee()  # linked to the scene's asset
    vendor = db_client.get(f"/api/v1/people/{person}", headers=scene.admin).json()[
        "vendorId"
    ]
    response = db_client.delete(f"/api/v1/vendors/{vendor}", headers=scene.admin)
    assert response.status_code == 409


def test_assignee_can_read_the_requester_while_assigned(
    scene: Scene, db_client: TestClient
) -> None:
    person_url = f"/api/v1/people/{scene.owner_id}"
    on_ticket, on_headers = scene.assignee()
    _, stranger = scene.assignee()

    assert db_client.get(person_url, headers=on_headers).status_code == 403

    a = scene.assign(on_ticket)
    assert a.status_code == 201, a.text
    shown = db_client.get(person_url, headers=on_headers)
    assert shown.status_code == 200
    assert shown.json()["id"] == str(scene.owner_id)
    # Only people on one of their tickets get to see the requester.
    assert db_client.get(person_url, headers=stranger).status_code == 403

    unassigned = db_client.delete(
        f"{scene.url}/assignments/{a.json()['id']}", headers=scene.sup
    )
    assert unassigned.status_code == 204
    assert db_client.get(person_url, headers=on_headers).status_code == 403


def test_requester_cannot_read_another_requester_even_via_assignee(
    scene: Scene, db_client: TestClient
) -> None:
    other = scene.seed.person(Role.requester)
    on_ticket, on_headers = scene.assignee()
    scene.assign(on_ticket)
    # Being on the owner's ticket says nothing about unrelated requesters.
    assert (
        db_client.get(f"/api/v1/people/{other}", headers=on_headers).status_code == 403
    )
    assert (
        db_client.get(f"/api/v1/people/{other}", headers=scene.owner).status_code == 403
    )
