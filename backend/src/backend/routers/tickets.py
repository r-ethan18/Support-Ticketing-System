from datetime import datetime
from typing import Annotated
from uuid import UUID

import psycopg.errors
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http
from psycopg.rows import class_row

from backend.auth import CurrentUserDep, require_roles
from backend.db import PoolDep, fetch_page, like_pattern
from backend.errors import CONFLICT, FORBIDDEN, NOT_FOUND
from backend.routers.deps import PaginationDep
from backend.schemas.enums import (
    AttachmentKind,
    Role,
    SortOrder,
    TicketPriority,
    TicketSortField,
    TicketStatus,
)
from backend.schemas.tickets import (
    Ticket,
    TicketAssignment,
    TicketAssignmentCreate,
    TicketAttachment,
    TicketAttachmentCreate,
    TicketComment,
    TicketCommentCreate,
    TicketCreate,
    TicketPage,
    TicketStatusHistoryEntry,
    TicketUpdate,
)
from backend.ticket_access import (
    TICKET_COLUMNS,
    TICKET_FROM,
    get_visible_ticket,
    visibility,
)

router = APIRouter(prefix="/tickets", tags=["tickets"])

supervisor_only = Depends(require_roles(Role.supervisor))


@router.get("", summary="List tickets")
async def list_tickets(
    page: PaginationDep,
    user: CurrentUserDep,
    pool: PoolDep,
    status: Annotated[list[TicketStatus] | None, Query()] = None,
    priority: Annotated[list[TicketPriority] | None, Query()] = None,
    requester_id: Annotated[UUID | None, Query(alias="requesterId")] = None,
    assignee_id: Annotated[
        UUID | None,
        Query(
            alias="assigneeId",
            description="Currently assigned (not unassigned) to this person",
        ),
    ] = None,
    supervisor_id: Annotated[UUID | None, Query(alias="supervisorId")] = None,
    asset_id: Annotated[UUID | None, Query(alias="assetId")] = None,
    department_id: Annotated[
        UUID | None,
        Query(alias="departmentId", description="Department owning the ticket's asset"),
    ] = None,
    created_from: Annotated[datetime | None, Query(alias="createdFrom")] = None,
    created_to: Annotated[datetime | None, Query(alias="createdTo")] = None,
    q: Annotated[str | None, Query(description="Match on title or description")] = None,
    sort_by: Annotated[
        TicketSortField, Query(alias="sortBy")
    ] = TicketSortField.created_at,
    order: SortOrder = SortOrder.desc,
) -> TicketPage:
    """Results are scoped to the caller: requesters see their own tickets,
    assignees see tickets assigned to them, supervisors see their department's
    (plus tickets with no asset yet), admins see all."""
    where: list[str] = []
    params: list[object] = []
    condition, extra = visibility(user)
    if condition:
        where.append(condition)
        params += extra
    if status:
        where.append("t.status = ANY(%s)")
        params.append([v.value for v in status])
    if priority:
        where.append("t.priority = ANY(%s)")
        params.append([v.value for v in priority])
    if requester_id:
        where.append("t.requester_id = %s")
        params.append(requester_id)
    if assignee_id:
        where.append(
            "EXISTS (SELECT 1 FROM ticket_assignment ta WHERE ta.ticket_id = t.id"
            " AND ta.assignee_id = %s AND ta.unassigned_at IS NULL)"
        )
        params.append(assignee_id)
    if supervisor_id:
        where.append("t.supervisor_id = %s")
        params.append(supervisor_id)
    if asset_id:
        where.append("t.asset_id = %s")
        params.append(asset_id)
    if department_id:
        where.append("a.department_id = %s")
        params.append(department_id)
    if created_from:
        where.append("t.created_at >= %s")
        params.append(created_from)
    if created_to:
        where.append("t.created_at <= %s")
        params.append(created_to)
    if q:
        where.append("(t.title ILIKE %s OR t.description ILIKE %s)")
        params += [like_pattern(q)] * 2
    direction = "ASC" if order is SortOrder.asc else "DESC"
    sort_sql = {
        TicketSortField.created_at: f"t.created_at {direction}",
        TicketSortField.closed_at: f"t.closed_at {direction} NULLS LAST",
        TicketSortField.priority: (
            "CASE t.priority WHEN 'low' THEN 0 WHEN 'medium' THEN 1"
            f" WHEN 'high' THEN 2 ELSE 3 END {direction}"
        ),
    }[sort_by]
    items, total = await fetch_page(
        pool,
        Ticket,
        select=f"{TICKET_COLUMNS} FROM {TICKET_FROM}",
        where=where,
        params=params,
        order_by=f"{sort_sql}, t.id",
        limit=page.limit,
        offset=page.offset,
    )
    return TicketPage(items=items, total=total, limit=page.limit, offset=page.offset)


@router.post(
    "",
    status_code=http.HTTP_201_CREATED,
    summary="Create a ticket",
    description="Created with status `open`; the requester is the caller.",
    dependencies=[Depends(require_roles(Role.requester))],
    responses=FORBIDDEN,
)
async def create_ticket(
    body: TicketCreate, user: CurrentUserDep, pool: PoolDep
) -> Ticket:
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=class_row(Ticket)) as cur:
            await cur.execute(
                "INSERT INTO ticket (title, description, location, priority, status,"
                " requester_id) VALUES (%s, %s, %s, %s, 'open', %s)"
                " RETURNING id, title, description, location, priority, status,"
                " created_at, closed_at, requester_id, asset_id, supervisor_id",
                (
                    body.title,
                    body.description,
                    body.location,
                    body.priority.value,
                    user.id,
                ),
            )
            ticket = await cur.fetchone()
        assert ticket is not None
        await conn.execute(
            "INSERT INTO ticket_status_history (ticket_id, from_status, to_status,"
            " changed_by_id) VALUES (%s, NULL, 'open', %s)",
            (ticket.id, user.id),
        )
    return ticket


@router.get("/{ticket_id}", summary="Get a ticket", responses=NOT_FOUND)
async def get_ticket(ticket_id: UUID, user: CurrentUserDep, pool: PoolDep) -> Ticket:
    return await get_visible_ticket(pool, ticket_id, user)


REQUESTER_EDITABLE = {"title", "description", "location", "priority"}


@router.patch(
    "/{ticket_id}",
    summary="Update a ticket",
    description=(
        "Supervisors and admins can set the asset, priority and supervisor and move"
        " the ticket through its statuses. Requesters can edit the title, description,"
        " location and priority of their own `open` ticket, or close it. Every status"
        " change is logged in the status history; moving to `closed` sets `closedAt`."
        " A closed ticket can no longer be changed."
    ),
    responses={**NOT_FOUND, **FORBIDDEN, **CONFLICT},
)
async def update_ticket(
    ticket_id: UUID, body: TicketUpdate, user: CurrentUserDep, pool: PoolDep
) -> Ticket:
    ticket = await get_visible_ticket(pool, ticket_id, user)
    changes = body.model_dump(exclude_none=True)
    if user.role is Role.assignee:
        raise HTTPException(http.HTTP_403_FORBIDDEN, detail="Insufficient role")
    if user.role is Role.requester:
        status_change = changes.pop("status", None)
        if set(changes) - REQUESTER_EDITABLE or status_change not in (
            None,
            TicketStatus.closed,
        ):
            raise HTTPException(
                http.HTTP_403_FORBIDDEN,
                detail="Requesters may only edit their ticket's details or close it",
            )
        if status_change:
            changes["status"] = status_change
    if ticket.status is TicketStatus.closed:
        raise HTTPException(http.HTTP_409_CONFLICT, detail="Ticket is closed")
    if (
        user.role is Role.requester
        and ticket.status is not TicketStatus.open
        and set(changes) - {"status"}
    ):
        raise HTTPException(
            http.HTTP_409_CONFLICT,
            detail="Only open tickets can be edited by their requester",
        )
    if not changes:
        return ticket

    new_status = changes.get("status")
    assignments = []
    sets = []
    for field, value in changes.items():
        sets.append(f"{field} = %s")
        assignments.append(value.value if hasattr(value, "value") else value)
    if new_status is TicketStatus.closed:
        sets.append("closed_at = now()")

    try:
        async with pool.connection() as conn:
            if changes.get("supervisor_id"):
                cur = await conn.execute(
                    "SELECT 1 FROM person WHERE id = %s AND role = 'supervisor'",
                    (changes["supervisor_id"],),
                )
                if not await cur.fetchone():
                    raise HTTPException(
                        http.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail="supervisorId must refer to a supervisor",
                    )
            async with conn.cursor(row_factory=class_row(Ticket)) as cur:
                await cur.execute(
                    f"UPDATE ticket t SET {', '.join(sets)} WHERE t.id = %s"
                    f" RETURNING {TICKET_COLUMNS}",
                    [*assignments, ticket_id],
                )
                updated = await cur.fetchone()
            assert updated is not None
            if new_status and new_status is not ticket.status:
                await conn.execute(
                    "INSERT INTO ticket_status_history (ticket_id, from_status,"
                    " to_status, changed_by_id) VALUES (%s, %s, %s, %s)",
                    (ticket_id, ticket.status.value, new_status.value, user.id),
                )
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(
            http.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown assetId"
        ) from None
    return updated


@router.delete(
    "/{ticket_id}",
    status_code=http.HTTP_204_NO_CONTENT,
    summary="Delete a ticket (admin only)",
    description="Also removes its assignments, attachments, comments and history.",
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**NOT_FOUND, **FORBIDDEN},
)
async def delete_ticket(ticket_id: UUID, pool: PoolDep) -> None:
    async with pool.connection() as conn:
        cur = await conn.execute("DELETE FROM ticket WHERE id = %s", (ticket_id,))
        if cur.rowcount == 0:
            raise HTTPException(http.HTTP_404_NOT_FOUND, detail="Ticket not found")


ASSIGNMENT_COLUMNS = "id, ticket_id, assignee_id, assigned_at, unassigned_at"
ATTACHMENT_COLUMNS = "id, ticket_id, uploaded_by_id, kind, storage_url, uploaded_at"


@router.get(
    "/{ticket_id}/assignments",
    summary="List a ticket's assignment history",
    responses=NOT_FOUND,
)
async def list_ticket_assignments(
    ticket_id: UUID, user: CurrentUserDep, pool: PoolDep
) -> list[TicketAssignment]:
    await get_visible_ticket(pool, ticket_id, user)
    async with (
        pool.connection() as conn,
        conn.cursor(row_factory=class_row(TicketAssignment)) as cur,
    ):
        await cur.execute(
            f"SELECT {ASSIGNMENT_COLUMNS} FROM ticket_assignment"
            " WHERE ticket_id = %s ORDER BY assigned_at, id",
            (ticket_id,),
        )
        return await cur.fetchall()


@router.post(
    "/{ticket_id}/assignments",
    status_code=http.HTTP_201_CREATED,
    summary="Assign a ticket to an assignee (supervisor or admin)",
    description=(
        "Several assignees can work on one ticket. Once the ticket has an asset, only"
        " assignees specialising in the asset's category can be assigned. Assigning an"
        " `open` ticket moves it to `assigned`."
    ),
    dependencies=[supervisor_only],
    responses={**NOT_FOUND, **FORBIDDEN, **CONFLICT},
)
async def create_ticket_assignment(
    ticket_id: UUID, body: TicketAssignmentCreate, user: CurrentUserDep, pool: PoolDep
) -> TicketAssignment:
    ticket = await get_visible_ticket(pool, ticket_id, user)
    if ticket.status is TicketStatus.closed:
        raise HTTPException(http.HTTP_409_CONFLICT, detail="Ticket is closed")
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT 1 FROM person WHERE id = %s AND role = 'assignee'",
            (body.assignee_id,),
        )
        if not await cur.fetchone():
            raise HTTPException(
                http.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="assigneeId must refer to an assignee",
            )
        if ticket.asset_id:
            cur = await conn.execute(
                "SELECT 1 FROM asset a JOIN assignee_category ac"
                " ON ac.category_id = a.category_id"
                " WHERE a.id = %s AND ac.person_id = %s",
                (ticket.asset_id, body.assignee_id),
            )
            if not await cur.fetchone():
                raise HTTPException(
                    http.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Assignee does not specialise in this asset's category",
                )
        try:
            async with conn.cursor(row_factory=class_row(TicketAssignment)) as cur:
                await cur.execute(
                    "INSERT INTO ticket_assignment (ticket_id, assignee_id)"
                    f" VALUES (%s, %s) RETURNING {ASSIGNMENT_COLUMNS}",
                    (ticket_id, body.assignee_id),
                )
                assignment = await cur.fetchone()
        except psycopg.errors.UniqueViolation:
            raise HTTPException(
                http.HTTP_409_CONFLICT, detail="Assignee is already on this ticket"
            ) from None
        assert assignment is not None
        if ticket.status is TicketStatus.open:
            await _set_status(
                conn, ticket_id, TicketStatus.open, TicketStatus.assigned, user.id
            )
    return assignment


async def _set_status(
    conn: psycopg.AsyncConnection,
    ticket_id: UUID,
    old: TicketStatus,
    new: TicketStatus,
    changed_by: UUID,
) -> None:
    await conn.execute(
        "UPDATE ticket SET status = %s WHERE id = %s", (new.value, ticket_id)
    )
    await conn.execute(
        "INSERT INTO ticket_status_history (ticket_id, from_status, to_status,"
        " changed_by_id) VALUES (%s, %s, %s, %s)",
        (ticket_id, old.value, new.value, changed_by),
    )


@router.delete(
    "/{ticket_id}/assignments/{assignment_id}",
    status_code=http.HTTP_204_NO_CONTENT,
    summary="Unassign (supervisor or admin)",
    description=(
        "Does not delete the row; sets `unassignedAt` so history is preserved."
        " Removing the last assignee of an `assigned` ticket moves it back to `open`."
    ),
    dependencies=[supervisor_only],
    responses={**NOT_FOUND, **FORBIDDEN},
)
async def delete_ticket_assignment(
    ticket_id: UUID, assignment_id: UUID, user: CurrentUserDep, pool: PoolDep
) -> None:
    ticket = await get_visible_ticket(pool, ticket_id, user)
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE ticket_assignment SET unassigned_at = now()"
            " WHERE id = %s AND ticket_id = %s AND unassigned_at IS NULL",
            (assignment_id, ticket_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(
                http.HTTP_404_NOT_FOUND, detail="Active assignment not found"
            )
        cur = await conn.execute(
            "SELECT 1 FROM ticket_assignment"
            " WHERE ticket_id = %s AND unassigned_at IS NULL LIMIT 1",
            (ticket_id,),
        )
        if ticket.status is TicketStatus.assigned and not await cur.fetchone():
            await _set_status(
                conn, ticket_id, TicketStatus.assigned, TicketStatus.open, user.id
            )


@router.get(
    "/{ticket_id}/attachments",
    summary="List a ticket's attachments",
    responses=NOT_FOUND,
)
async def list_ticket_attachments(
    ticket_id: UUID,
    user: CurrentUserDep,
    pool: PoolDep,
    kind: Annotated[AttachmentKind | None, Query()] = None,
) -> list[TicketAttachment]:
    await get_visible_ticket(pool, ticket_id, user)
    where, params = ["ticket_id = %s"], [ticket_id]
    if kind:
        where.append("kind = %s")
        params.append(kind.value)
    async with (
        pool.connection() as conn,
        conn.cursor(row_factory=class_row(TicketAttachment)) as cur,
    ):
        await cur.execute(
            f"SELECT {ATTACHMENT_COLUMNS} FROM ticket_attachment"
            f" WHERE {' AND '.join(where)} ORDER BY uploaded_at, id",
            params,
        )
        return await cur.fetchall()


@router.post(
    "/{ticket_id}/attachments",
    status_code=http.HTTP_201_CREATED,
    summary="Add an attachment to a ticket",
    description=(
        "`issue_evidence` is added by the ticket's requester, `completion_proof` by"
        " an assignee currently assigned to it. Admins can add either. Closed tickets"
        " take no new attachments."
    ),
    responses={**NOT_FOUND, **FORBIDDEN, **CONFLICT},
)
async def create_ticket_attachment(
    ticket_id: UUID, body: TicketAttachmentCreate, user: CurrentUserDep, pool: PoolDep
) -> TicketAttachment:
    ticket = await get_visible_ticket(pool, ticket_id, user)
    allowed = user.role is Role.admin
    if body.kind is AttachmentKind.issue_evidence:
        allowed = allowed or ticket.requester_id == user.id
    elif user.role is Role.assignee:
        # Visibility already means they are currently assigned.
        allowed = True
    if not allowed:
        raise HTTPException(
            http.HTTP_403_FORBIDDEN,
            detail=f"You may not add {body.kind.value} to this ticket",
        )
    if ticket.status is TicketStatus.closed:
        raise HTTPException(http.HTTP_409_CONFLICT, detail="Ticket is closed")
    async with (
        pool.connection() as conn,
        conn.cursor(row_factory=class_row(TicketAttachment)) as cur,
    ):
        await cur.execute(
            "INSERT INTO ticket_attachment (ticket_id, uploaded_by_id, kind,"
            f" storage_url) VALUES (%s, %s, %s, %s) RETURNING {ATTACHMENT_COLUMNS}",
            (ticket_id, user.id, body.kind.value, body.storage_url),
        )
        attachment = await cur.fetchone()
    assert attachment is not None
    return attachment


COMMENT_COLUMNS = "id, ticket_id, author_id, body, created_at"


@router.get(
    "/{ticket_id}/comments",
    summary="List a ticket's comments",
    description="Oldest first. Visible to everyone who can see the ticket.",
    responses=NOT_FOUND,
)
async def list_ticket_comments(
    ticket_id: UUID, user: CurrentUserDep, pool: PoolDep
) -> list[TicketComment]:
    await get_visible_ticket(pool, ticket_id, user)
    async with (
        pool.connection() as conn,
        conn.cursor(row_factory=class_row(TicketComment)) as cur,
    ):
        await cur.execute(
            f"SELECT {COMMENT_COLUMNS} FROM ticket_comment"
            " WHERE ticket_id = %s ORDER BY created_at, id",
            (ticket_id,),
        )
        return await cur.fetchall()


@router.post(
    "/{ticket_id}/comments",
    status_code=http.HTTP_201_CREATED,
    summary="Comment on a ticket",
    description=(
        "The ticket's chat: its requester, supervisors, current assignees and admins"
        " can post. Closed tickets are read-only."
    ),
    responses={**NOT_FOUND, **CONFLICT},
)
async def create_ticket_comment(
    ticket_id: UUID, body: TicketCommentCreate, user: CurrentUserDep, pool: PoolDep
) -> TicketComment:
    ticket = await get_visible_ticket(pool, ticket_id, user)
    if ticket.status is TicketStatus.closed:
        raise HTTPException(http.HTTP_409_CONFLICT, detail="Ticket is closed")
    async with (
        pool.connection() as conn,
        conn.cursor(row_factory=class_row(TicketComment)) as cur,
    ):
        await cur.execute(
            "INSERT INTO ticket_comment (ticket_id, author_id, body)"
            f" VALUES (%s, %s, %s) RETURNING {COMMENT_COLUMNS}",
            (ticket_id, user.id, body.body),
        )
        comment = await cur.fetchone()
    assert comment is not None
    return comment


@router.get(
    "/{ticket_id}/status-history",
    summary="List a ticket's status changes",
    responses=NOT_FOUND,
)
async def list_ticket_status_history(
    ticket_id: UUID, user: CurrentUserDep, pool: PoolDep
) -> list[TicketStatusHistoryEntry]:
    await get_visible_ticket(pool, ticket_id, user)
    async with (
        pool.connection() as conn,
        conn.cursor(row_factory=class_row(TicketStatusHistoryEntry)) as cur,
    ):
        await cur.execute(
            "SELECT id, ticket_id, from_status, to_status, changed_by_id, changed_at"
            " FROM ticket_status_history WHERE ticket_id = %s"
            " ORDER BY changed_at, id",
            (ticket_id,),
        )
        return await cur.fetchall()
