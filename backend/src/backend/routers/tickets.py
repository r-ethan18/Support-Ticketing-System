from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi import status as http

from backend.auth import CurrentUserDep, require_roles
from backend.errors import FORBIDDEN, NOT_FOUND, not_implemented
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

router = APIRouter(prefix="/tickets", tags=["tickets"])

supervisor_only = Depends(require_roles(Role.supervisor))


@router.get("", summary="List tickets")
async def list_tickets(
    page: PaginationDep,
    user: CurrentUserDep,
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
    assignees see tickets assigned to them, supervisors see their department's."""
    not_implemented()


@router.post(
    "",
    status_code=http.HTTP_201_CREATED,
    summary="Create a ticket",
    description="Created with status `open`; the requester is the caller.",
)
async def create_ticket(body: TicketCreate, user: CurrentUserDep) -> Ticket:
    not_implemented()


@router.get("/{ticket_id}", summary="Get a ticket", responses=NOT_FOUND)
async def get_ticket(ticket_id: UUID) -> Ticket:
    not_implemented()


@router.patch(
    "/{ticket_id}",
    summary="Update a ticket (supervisor only)",
    description=(
        "Used by supervisors to set the asset, priority and supervisor, and to move the"
        " ticket through its statuses. Every status change is logged in the status history;"
        " moving to `closed` sets `closedAt`."
    ),
    dependencies=[supervisor_only],
    responses={**NOT_FOUND, **FORBIDDEN},
)
async def update_ticket(ticket_id: UUID, body: TicketUpdate) -> Ticket:
    not_implemented()


@router.get(
    "/{ticket_id}/assignments",
    summary="List a ticket's assignment history",
    responses=NOT_FOUND,
)
async def list_ticket_assignments(ticket_id: UUID) -> list[TicketAssignment]:
    not_implemented()


@router.post(
    "/{ticket_id}/assignments",
    status_code=http.HTTP_201_CREATED,
    summary="Assign a ticket to an assignee (supervisor only)",
    dependencies=[supervisor_only],
    responses={**NOT_FOUND, **FORBIDDEN},
)
async def create_ticket_assignment(
    ticket_id: UUID, body: TicketAssignmentCreate
) -> TicketAssignment:
    not_implemented()


@router.delete(
    "/{ticket_id}/assignments/{assignment_id}",
    status_code=http.HTTP_204_NO_CONTENT,
    summary="Unassign (supervisor only)",
    description="Does not delete the row; sets `unassignedAt` so history is preserved.",
    dependencies=[supervisor_only],
    responses={**NOT_FOUND, **FORBIDDEN},
)
async def delete_ticket_assignment(ticket_id: UUID, assignment_id: UUID) -> None:
    not_implemented()


@router.get(
    "/{ticket_id}/attachments",
    summary="List a ticket's attachments",
    responses=NOT_FOUND,
)
async def list_ticket_attachments(
    ticket_id: UUID,
    kind: Annotated[AttachmentKind | None, Query()] = None,
) -> list[TicketAttachment]:
    not_implemented()


@router.post(
    "/{ticket_id}/attachments",
    status_code=http.HTTP_201_CREATED,
    summary="Add an attachment to a ticket",
    description=(
        "`issue_evidence` is added by the requester, `completion_proof` by the assignee."
    ),
    responses={**NOT_FOUND, **FORBIDDEN},
)
async def create_ticket_attachment(
    ticket_id: UUID, body: TicketAttachmentCreate, user: CurrentUserDep
) -> TicketAttachment:
    not_implemented()


@router.get(
    "/{ticket_id}/comments", summary="List a ticket's comments", responses=NOT_FOUND
)
async def list_ticket_comments(ticket_id: UUID) -> list[TicketComment]:
    not_implemented()


@router.post(
    "/{ticket_id}/comments",
    status_code=http.HTTP_201_CREATED,
    summary="Comment on a ticket",
    responses=NOT_FOUND,
)
async def create_ticket_comment(
    ticket_id: UUID, body: TicketCommentCreate, user: CurrentUserDep
) -> TicketComment:
    not_implemented()


@router.get(
    "/{ticket_id}/status-history",
    summary="List a ticket's status changes",
    responses=NOT_FOUND,
)
async def list_ticket_status_history(ticket_id: UUID) -> list[TicketStatusHistoryEntry]:
    not_implemented()
