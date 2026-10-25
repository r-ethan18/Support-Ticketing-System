from datetime import datetime
from uuid import UUID

from backend.schemas.base import CamelModel, Page
from backend.schemas.enums import AttachmentKind, TicketPriority, TicketStatus


class Ticket(CamelModel):
    id: UUID
    title: str
    description: str
    location: str
    priority: TicketPriority
    status: TicketStatus
    created_at: datetime
    closed_at: datetime | None = None
    requester_id: UUID
    # Unknown to the requester; filled in later by a supervisor.
    asset_id: UUID | None = None
    supervisor_id: UUID | None = None


class TicketCreate(CamelModel):
    """What a requester submits. The asset is deliberately absent."""

    title: str
    description: str
    location: str
    priority: TicketPriority = TicketPriority.medium


class TicketUpdate(CamelModel):
    """Partial update; omitted fields are left unchanged."""

    title: str | None = None
    description: str | None = None
    location: str | None = None
    priority: TicketPriority | None = None
    status: TicketStatus | None = None
    asset_id: UUID | None = None
    supervisor_id: UUID | None = None


class TicketAssignment(CamelModel):
    id: UUID
    ticket_id: UUID
    assignee_id: UUID
    assigned_at: datetime
    unassigned_at: datetime | None = None


class TicketAssignmentCreate(CamelModel):
    assignee_id: UUID


class TicketAttachment(CamelModel):
    id: UUID
    ticket_id: UUID
    uploaded_by_id: UUID
    kind: AttachmentKind
    storage_url: str
    uploaded_at: datetime


class TicketAttachmentCreate(CamelModel):
    # PLACEHOLDER: assumes the file is already in storage and the client
    # registers its URL. Swap for multipart / presigned upload if preferred.
    kind: AttachmentKind
    storage_url: str


class TicketComment(CamelModel):
    id: UUID
    ticket_id: UUID
    author_id: UUID
    body: str
    created_at: datetime


class TicketCommentCreate(CamelModel):
    body: str


class TicketStatusHistoryEntry(CamelModel):
    id: UUID
    ticket_id: UUID
    from_status: TicketStatus | None = None
    to_status: TicketStatus
    changed_by_id: UUID
    changed_at: datetime


class TicketPage(Page[Ticket]):
    pass
