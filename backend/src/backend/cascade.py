"""What happens to the rest of the data when people (or the places they belong
to) go away. Callers run these inside one transaction on `conn`.
"""

from collections.abc import Sequence
from uuid import UUID

from psycopg import AsyncConnection


async def release_assignments(
    conn: AsyncConnection, person_ids: Sequence[UUID], actor_id: UUID
) -> None:
    """End the people's current ticket assignments.

    A ticket left with nobody assigned goes back to `open` (recorded in its
    status history as `actor_id`'s doing) so a supervisor picks it up again.
    """
    cur = await conn.execute(
        "UPDATE ticket_assignment SET unassigned_at = now()"
        " WHERE assignee_id = ANY(%s) AND unassigned_at IS NULL RETURNING ticket_id",
        (list(person_ids),),
    )
    ticket_ids = list({row[0] for row in await cur.fetchall()})
    if not ticket_ids:
        return
    cur = await conn.execute(
        """
        UPDATE ticket t SET status = 'open'
        FROM (SELECT id, status FROM ticket WHERE id = ANY(%s)) AS before
        WHERE t.id = before.id
          AND t.status = 'assigned'
          AND NOT EXISTS (
              SELECT 1 FROM ticket_assignment a
              WHERE a.ticket_id = t.id AND a.unassigned_at IS NULL)
        RETURNING t.id, before.status
        """,
        (ticket_ids,),
    )
    for ticket_id, old_status in await cur.fetchall():
        await conn.execute(
            "INSERT INTO ticket_status_history (ticket_id, from_status, to_status,"
            " changed_by_id) VALUES (%s, %s, 'open', %s)",
            (ticket_id, old_status, actor_id),
        )


async def demote_to_requester(
    conn: AsyncConnection, person_ids: Sequence[UUID]
) -> None:
    """Strip staff roles: back to plain requesters, off any ticket they supervise."""
    ids = list(person_ids)
    await conn.execute(
        "UPDATE ticket SET supervisor_id = NULL WHERE supervisor_id = ANY(%s)", (ids,)
    )
    await conn.execute(
        "UPDATE person SET role = 'requester', vendor_id = NULL, department_id = NULL"
        " WHERE id = ANY(%s)",
        (ids,),
    )


async def remove_vendor(conn: AsyncConnection, vendor_id: UUID, actor_id: UUID) -> bool:
    """Delete a vendor; its technicians are unassigned and become requesters.

    Returns False if there is no such vendor.
    """
    cur = await conn.execute("SELECT id FROM person WHERE vendor_id = %s", (vendor_id,))
    technicians = [row[0] for row in await cur.fetchall()]
    if technicians:
        await release_assignments(conn, technicians, actor_id)
        await demote_to_requester(conn, technicians)
    cur = await conn.execute("DELETE FROM vendor WHERE id = %s", (vendor_id,))
    return cur.rowcount > 0


async def remove_department(conn: AsyncConnection, department_id: UUID) -> bool:
    """Delete a department, its assets and the supervisor role of its supervisors.

    Tickets on the removed assets keep existing, without an asset. Returns False
    if there is no such department.
    """
    cur = await conn.execute(
        "SELECT id FROM person WHERE department_id = %s", (department_id,)
    )
    supervisors = [row[0] for row in await cur.fetchall()]
    if supervisors:
        await demote_to_requester(conn, supervisors)
    await conn.execute("DELETE FROM asset WHERE department_id = %s", (department_id,))
    cur = await conn.execute("DELETE FROM department WHERE id = %s", (department_id,))
    return cur.rowcount > 0
