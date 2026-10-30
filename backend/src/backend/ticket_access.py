"""Who may see which tickets, shared by every `/tickets/...` route."""

from uuid import UUID

from fastapi import HTTPException, status
from psycopg_pool import AsyncConnectionPool

from backend.auth import CurrentUser
from backend.db import fetch_one
from backend.schemas.enums import Role
from backend.schemas.tickets import Ticket

# `ticket` is aliased `t` and `asset` is LEFT JOINed as `a` wherever this is used.
TICKET_FROM = "ticket t LEFT JOIN asset a ON a.id = t.asset_id"
REOPEN_REQUESTED_SQL = (
    "(t.status = 'closed' AND EXISTS ("
    " SELECT 1 FROM ("
    "   SELECT body FROM ticket_comment tc"
    "   WHERE tc.ticket_id = t.id AND tc.body LIKE '[Reopen%%'"
    "   ORDER BY tc.created_at DESC, tc.id DESC LIMIT 1"
    " ) last_rc WHERE last_rc.body LIKE '[Reopen Requested]%%'"
    "))"
)
TICKET_COLUMNS = (
    "t.id, t.title, t.description, t.location, t.priority, t.status, t.created_at,"
    f" t.closed_at, t.requester_id, t.asset_id, t.supervisor_id, {REOPEN_REQUESTED_SQL} AS reopen_requested"
)


def visibility(user: CurrentUser) -> tuple[str | None, list[object]]:
    """SQL condition limiting tickets to those `user` may see (None = all).

    - requester: tickets they created
    - assignee: tickets they are currently assigned to
    - supervisor: tickets about their department's assets, tickets they
      supervise, and tickets with no asset yet (the triage queue, since a
      requester cannot know the asset)
    - admin: everything
    """
    match user.role:
        case Role.admin:
            return None, []
        case Role.requester:
            return "t.requester_id = %s", [user.id]
        case Role.assignee:
            condition = (
                "EXISTS (SELECT 1 FROM ticket_assignment ta"
                " WHERE ta.ticket_id = t.id AND ta.assignee_id = %s"
                " AND ta.unassigned_at IS NULL)"
            )
            return condition, [user.id]
        case Role.supervisor:
            condition = (
                "(t.supervisor_id = %s OR t.asset_id IS NULL OR a.department_id ="
                " (SELECT department_id FROM person WHERE id = %s))"
            )
            return condition, [user.id, user.id]


async def get_visible_ticket(
    pool: AsyncConnectionPool, ticket_id: UUID, user: CurrentUser
) -> Ticket:
    """The ticket, or 404 if it does not exist or `user` may not see it."""
    where = ["t.id = %s"]
    params: list[object] = [ticket_id]
    condition, extra = visibility(user)
    if condition:
        where.append(condition)
        params += extra
    ticket = await fetch_one(
        pool,
        Ticket,
        f"SELECT {TICKET_COLUMNS} FROM {TICKET_FROM} WHERE {' AND '.join(where)}",
        params,
    )
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket
