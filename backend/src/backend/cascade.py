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
