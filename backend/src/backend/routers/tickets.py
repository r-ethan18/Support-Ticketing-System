import asyncio
import json
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import quote
from uuid import UUID, uuid4

import psycopg.errors
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi import status as http
from fastapi.responses import Response, StreamingResponse
from psycopg.rows import class_row

from backend.auth import CurrentUserDep, require_roles
from backend.config import get_settings
from backend.db import HubDep, PoolDep, fetch_page, like_pattern
from backend.errors import CONFLICT, FORBIDDEN, NOT_FOUND, ErrorResponse
from backend.pubsub import PubSubHub
from backend.routers.deps import PaginationDep
from backend.schemas.enums import (
    AttachmentKind,
    Role,
    SortOrder,
    TicketPriority,
    TicketSortField,
    TicketStatus,
    TicketStatusFilter,
)
from backend.schemas.tickets import (
    Ticket,
    TicketAssignment,
    TicketAssignmentCreate,
    TicketAttachment,
    TicketComment,
    TicketCommentCreate,
    TicketCreate,
    TicketPage,
    TicketStatusHistoryEntry,
    TicketUpdate,
)
from backend.storage import ObjectStoreDep, OptionalObjectStoreDep, discard_objects
from backend.ticket_access import (
    REOPEN_REQUESTED_SQL,
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
    status: Annotated[list[TicketStatusFilter] | None, Query()] = None,
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
        has_reopen_req = any(
            s == "reopen_requested" or s == TicketStatusFilter.reopen_requested
            for s in status
        )
        regular_statuses = [
            s.value if hasattr(s, "value") else str(s)
            for s in status
            if s != "reopen_requested" and s != TicketStatusFilter.reopen_requested
        ]
        conds = []
        if regular_statuses:
            conds.append("t.status = ANY(%s)")
            params.append(regular_statuses)
        if has_reopen_req:
            conds.append(REOPEN_REQUESTED_SQL)
        if conds:
            where.append(f"({' OR '.join(conds)})")
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
                " created_at, closed_at, requester_id, asset_id, supervisor_id, FALSE AS reopen_requested",
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
    ticket_id: UUID,
    body: TicketUpdate,
    user: CurrentUserDep,
    pool: PoolDep,
    hub: HubDep,
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
    if ticket.status is TicketStatus.closed and (
        user.role not in (Role.supervisor, Role.admin)
        or changes.get("status")
        not in (
            TicketStatus.open,
            TicketStatus.assigned,
            TicketStatus.in_progress,
        )
    ):
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
    elif (
        ticket.status is TicketStatus.closed
        and new_status
        and new_status is not TicketStatus.closed
    ):
        sets.append("closed_at = NULL")

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
    if new_status and new_status is not ticket.status:
        await _publish_status(hub, ticket_id, new_status)
    return updated


async def _publish_status(
    hub: PubSubHub, ticket_id: UUID, status: TicketStatus
) -> None:
    await hub.publish(
        ticket_id,
        {
            "event": "status",
            "data": {
                "ticketId": str(ticket_id),
                "status": status.value,
                "changedAt": datetime.now(UTC).isoformat(),
            },
        },
    )


async def _publish_assignments_changed(hub: PubSubHub, ticket_id: UUID) -> None:
    await hub.publish(
        ticket_id, {"event": "assignment", "data": {"ticketId": str(ticket_id)}}
    )


@router.delete(
    "/{ticket_id}",
    status_code=http.HTTP_204_NO_CONTENT,
    summary="Delete a ticket (admin only)",
    description="Also removes its assignments, attachments, comments and history.",
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**NOT_FOUND, **FORBIDDEN},
)
async def delete_ticket(
    ticket_id: UUID, pool: PoolDep, hub: HubDep, store: OptionalObjectStoreDep
) -> None:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT object_key FROM ticket_attachment"
            " WHERE ticket_id = %s AND object_key IS NOT NULL",
            (ticket_id,),
        )
        keys = [row[0] for row in await cur.fetchall()]
        cur = await conn.execute("DELETE FROM ticket WHERE id = %s", (ticket_id,))
        if cur.rowcount == 0:
            raise HTTPException(http.HTTP_404_NOT_FOUND, detail="Ticket not found")
    await discard_objects(store, keys)
    await hub.publish(
        ticket_id, {"event": "deleted", "data": {"ticketId": str(ticket_id)}}
    )


ASSIGNMENT_COLUMNS = "id, ticket_id, assignee_id, assigned_at, unassigned_at"
# Uploads are served by this API (the bucket is never exposed), so their
# `storage_url` is the content route; older rows keep their external link.
ATTACHMENT_COLUMNS = """
    id, ticket_id, uploaded_by_id, kind, filename, content_type, size_bytes,
    uploaded_at,
    CASE WHEN object_key IS NULL THEN storage_url
         ELSE '/api/v1/tickets/' || ticket_id || '/attachments/' || id || '/content'
    END AS storage_url
"""

ALLOWED_UPLOAD_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
}


def _clean_filename(name: str | None) -> str:
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(c for c in base if c.isprintable()).strip()
    return base[:255] or "file"


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
        " assignees employed by a vendor responsible for that asset can be assigned. Assigning an"
        " `open` ticket moves it to `assigned`."
    ),
    dependencies=[supervisor_only],
    responses={**NOT_FOUND, **FORBIDDEN, **CONFLICT},
)
async def create_ticket_assignment(
    ticket_id: UUID,
    body: TicketAssignmentCreate,
    user: CurrentUserDep,
    pool: PoolDep,
    hub: HubDep,
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
                "SELECT 1 FROM asset_vendor av JOIN person p"
                " ON p.vendor_id = av.vendor_id"
                " WHERE av.asset_id = %s AND p.id = %s",
                (ticket.asset_id, body.assignee_id),
            )
            if not await cur.fetchone():
                raise HTTPException(
                    http.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Assignee's vendor is not responsible for this asset",
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
    await _publish_assignments_changed(hub, ticket_id)
    if ticket.status is TicketStatus.open:
        await _publish_status(hub, ticket_id, TicketStatus.assigned)
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
    ticket_id: UUID,
    assignment_id: UUID,
    user: CurrentUserDep,
    pool: PoolDep,
    hub: HubDep,
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
        reopened = ticket.status is TicketStatus.assigned and not await cur.fetchone()
        if reopened:
            await _set_status(
                conn, ticket_id, TicketStatus.assigned, TicketStatus.open, user.id
            )
    await _publish_assignments_changed(hub, ticket_id)
    if reopened:
        await _publish_status(hub, ticket_id, TicketStatus.open)


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
    summary="Upload an attachment to a ticket",
    description=(
        "Multipart upload of an image (PNG, JPEG, GIF, WebP) or PDF.\n\n"
        "`issue_evidence` is added by the ticket's requester, `completion_proof` by"
        " an assignee currently assigned to it. Admins can add either. Closed tickets"
        " take no new attachments."
    ),
    responses={
        **NOT_FOUND,
        **FORBIDDEN,
        **CONFLICT,
        413: {"model": ErrorResponse, "description": "File is too large"},
        415: {"model": ErrorResponse, "description": "File type is not allowed"},
        503: {"model": ErrorResponse, "description": "File storage is unavailable"},
    },
)
async def create_ticket_attachment(
    ticket_id: UUID,
    kind: Annotated[AttachmentKind, Form()],
    file: Annotated[UploadFile, File()],
    user: CurrentUserDep,
    pool: PoolDep,
    store: ObjectStoreDep,
) -> TicketAttachment:
    ticket = await get_visible_ticket(pool, ticket_id, user)
    allowed = user.role is Role.admin
    if kind is AttachmentKind.issue_evidence:
        allowed = allowed or ticket.requester_id == user.id
    elif user.role is Role.assignee:
        # Visibility already means they are currently assigned.
        allowed = True
    if not allowed:
        raise HTTPException(
            http.HTTP_403_FORBIDDEN,
            detail=f"You may not add {kind.value} to this ticket",
        )
    if ticket.status is TicketStatus.closed:
        raise HTTPException(http.HTTP_409_CONFLICT, detail="Ticket is closed")
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(
            http.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PNG, JPEG, GIF, WebP images and PDFs can be attached",
        )
    limit = get_settings().storage.max_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            http.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Files can be at most {limit // (1024 * 1024)} MB",
        )
    if not data:
        raise HTTPException(http.HTTP_422_UNPROCESSABLE_CONTENT, detail="File is empty")

    key = f"tickets/{ticket_id}/{uuid4()}"
    await store.put(key, data, content_type)
    try:
        async with (
            pool.connection() as conn,
            conn.cursor(row_factory=class_row(TicketAttachment)) as cur,
        ):
            await cur.execute(
                "INSERT INTO ticket_attachment (ticket_id, uploaded_by_id, kind,"
                " object_key, filename, content_type, size_bytes)"
                f" VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING {ATTACHMENT_COLUMNS}",
                (
                    ticket_id,
                    user.id,
                    kind.value,
                    key,
                    _clean_filename(file.filename),
                    content_type,
                    len(data),
                ),
            )
            attachment = await cur.fetchone()
    except Exception:
        await discard_objects(store, [key])
        raise
    assert attachment is not None
    return attachment


@router.get(
    "/{ticket_id}/attachments/{attachment_id}/content",
    summary="Download an attachment's file",
    description="Streams the uploaded file. Visible to anyone who can see the ticket.",
    response_class=Response,
    responses={
        200: {
            "description": "The file",
            "content": {t: {} for t in sorted(ALLOWED_UPLOAD_TYPES)},
        },
        **NOT_FOUND,
        503: {"model": ErrorResponse, "description": "File storage is unavailable"},
    },
)
async def get_ticket_attachment_content(
    ticket_id: UUID,
    attachment_id: UUID,
    user: CurrentUserDep,
    pool: PoolDep,
    store: ObjectStoreDep,
) -> Response:
    await get_visible_ticket(pool, ticket_id, user)
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT object_key, filename, content_type FROM ticket_attachment"
            " WHERE id = %s AND ticket_id = %s",
            (attachment_id, ticket_id),
        )
        row = await cur.fetchone()
    if row is None or row[0] is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, detail="Attachment not found")
    key, filename, content_type = row
    data = await store.get(key)
    if data is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, detail="Attachment not found")
    disposition = "inline" if content_type.startswith("image/") else "attachment"
    return Response(
        data,
        media_type=content_type,
        headers={
            "Content-Disposition": (
                f"{disposition}; filename*=UTF-8''{quote(filename or 'file')}"
            ),
            # Uploads are user content: never let a browser guess or run them.
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "private, max-age=3600",
        },
    )


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
    ticket_id: UUID,
    body: TicketCommentCreate,
    user: CurrentUserDep,
    pool: PoolDep,
    hub: HubDep,
) -> TicketComment:
    ticket = await get_visible_ticket(pool, ticket_id, user)
    if ticket.status is TicketStatus.closed and not body.body.strip().startswith(
        "[Reopen"
    ):
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
    # Notify all SSE subscribers watching this ticket.
    await hub.publish(
        ticket_id,
        {
            "event": "comment",
            "data": json.loads(comment.model_dump_json(by_alias=True)),
        },
    )
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


# ---------------------------------------------------------------------------
# SSE stream endpoint
# ---------------------------------------------------------------------------


async def _sse_generator(
    ticket_id: UUID,
    hub: PubSubHub,
    still_visible: Callable[[], Awaitable[bool]],
    heartbeat_secs: float = 25,
) -> AsyncGenerator[str]:
    """Yield SSE-formatted text chunks until the client disconnects.

    Access was checked when the stream opened; it is checked again at every
    heartbeat, so the stream ends (`closed`) once the ticket is deleted or the
    caller can no longer see it (unassigned, demoted, account deleted).
    """
    q = hub.subscribe(ticket_id)
    try:
        # Send an initial 'connected' ping so the browser EventSource doesn't
        # stay in CONNECTING state while waiting for the first real event.
        yield f'event: connected\ndata: {{"ticketId": "{ticket_id}"}}\n\n'
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=heartbeat_secs)
            except TimeoutError:
                if not await still_visible():
                    yield "event: closed\ndata: {}\n\n"
                    return
                # Keep the connection alive; browsers expect at least one byte
                # every ~30 s or they may time out.
                yield ": heartbeat\n\n"
                continue
            payload = json.dumps(event["data"])
            yield f"event: {event['event']}\ndata: {payload}\n\n"
            if event["event"] == "deleted":
                return
    finally:
        hub.unsubscribe(ticket_id, q)


@router.get(
    "/{ticket_id}/stream",
    summary="SSE stream of live updates for a ticket",
    description=(
        "Server-Sent Events endpoint. Connect with `EventSource` (with an"
        " Authorization header via a custom fetch). Emits `comment` events when"
        " a new comment is posted and `status` events when the ticket status"
        " changes, `assignment` events when assignees change, `resync` when the"
        " client fell behind and should reload, and `deleted`/`closed` just before"
        " the server ends the stream (ticket deleted, or the caller lost access)."
        " A `connected` event is sent immediately on connection, and a"
        " `: heartbeat` comment every 25 s keeps the connection alive; access is"
        " re-checked at each heartbeat."
    ),
    response_class=StreamingResponse,
    responses=NOT_FOUND,
)
async def stream_ticket(
    ticket_id: UUID, user: CurrentUserDep, pool: PoolDep, hub: HubDep
) -> StreamingResponse:
    """Long-lived SSE connection scoped to a single ticket."""
    # Enforce visibility: 404 / 403 as usual.
    await get_visible_ticket(pool, ticket_id, user)

    async def still_visible() -> bool:
        try:
            await get_visible_ticket(pool, ticket_id, user)
        except HTTPException:
            return False
        return True

    return StreamingResponse(
        _sse_generator(ticket_id, hub, still_visible),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable Nginx/Traefik response buffering
            "Connection": "keep-alive",
        },
    )
