from uuid import uuid4

from fastapi.testclient import TestClient

from backend.schemas.enums import Role
from tests.conftest import PASSWORD, Seeder

AUTH = "/api/v1/auth"


def _login(client: TestClient, seed: Seeder, role: Role = Role.requester) -> dict:
    person_id = seed.person(role)
    email = seed.conn.execute(
        "SELECT email FROM person WHERE id = %s", (person_id,)
    ).fetchone()[0]
    response = client.post(f"{AUTH}/token", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"id": person_id, "email": email, **response.json()}


def _refresh(client: TestClient, token: str):
    return client.post(f"{AUTH}/refresh", json={"refreshToken": token})


def test_refresh_rotates_the_token(db_client: TestClient, seed: Seeder) -> None:
    session = _login(db_client, seed)
    refreshed = _refresh(db_client, session["refreshToken"])
    assert refreshed.status_code == 200
    body = refreshed.json()
    assert body["refreshToken"] != session["refreshToken"]

    headers = {"Authorization": f"Bearer {body['accessToken']}"}
    assert db_client.get(f"{AUTH}/me", headers=headers).status_code == 200
    # The successor works too.
    assert _refresh(db_client, body["refreshToken"]).status_code == 200


def test_reusing_a_retired_token_revokes_the_session(
    db_client: TestClient, seed: Seeder
) -> None:
    session = _login(db_client, seed)
    successor = _refresh(db_client, session["refreshToken"]).json()["refreshToken"]

    assert _refresh(db_client, session["refreshToken"]).status_code == 401
    # The thief's replay also killed the legitimate holder's successor.
    assert _refresh(db_client, successor).status_code == 401


def test_unknown_and_expired_tokens_are_rejected(
    db_client: TestClient, seed: Seeder
) -> None:
    assert _refresh(db_client, "not-a-token").status_code == 401

    session = _login(db_client, seed)
    seed.conn.execute(
        "UPDATE refresh_token SET expires_at = now() - interval '1 second'"
        " WHERE person_id = %s",
        (session["id"],),
    )
    assert _refresh(db_client, session["refreshToken"]).status_code == 401


def test_refresh_picks_up_role_changes(db_client: TestClient, seed: Seeder) -> None:
    dept = seed.insert("department", name=f"dept {uuid4()}")
    session = _login(db_client, seed)
    seed.conn.execute(
        "UPDATE person SET role = 'supervisor', department_id = %s WHERE id = %s",
        (dept, session["id"]),
    )
    body = _refresh(db_client, session["refreshToken"]).json()
    headers = {"Authorization": f"Bearer {body['accessToken']}"}
    assert db_client.get("/api/v1/people", headers=headers).status_code == 200


def test_logout_revokes_the_session(db_client: TestClient, seed: Seeder) -> None:
    session = _login(db_client, seed)
    out = db_client.post(
        f"{AUTH}/logout", json={"refreshToken": session["refreshToken"]}
    )
    assert out.status_code == 204
    assert _refresh(db_client, session["refreshToken"]).status_code == 401
    # Idempotent, and unknown tokens do not error.
    assert (
        db_client.post(f"{AUTH}/logout", json={"refreshToken": "nope"}).status_code
        == 204
    )


def test_changing_password_signs_out_every_session(
    db_client: TestClient, seed: Seeder
) -> None:
    first = _login(db_client, seed)
    second = db_client.post(
        f"{AUTH}/token", json={"email": first["email"], "password": PASSWORD}
    ).json()
    headers = {"Authorization": f"Bearer {first['accessToken']}"}
    changed = db_client.post(
        f"{AUTH}/password",
        headers=headers,
        json={"currentPassword": PASSWORD, "newPassword": "a brand new passphrase"},
    )
    assert changed.status_code == 204
    assert _refresh(db_client, first["refreshToken"]).status_code == 401
    assert _refresh(db_client, second["refreshToken"]).status_code == 401


def test_deleting_a_person_ends_their_sessions(
    db_client: TestClient, seed: Seeder
) -> None:
    session = _login(db_client, seed, Role.supervisor)
    seed.conn.execute("DELETE FROM person WHERE id = %s", (session["id"],))
    assert _refresh(db_client, session["refreshToken"]).status_code == 401
