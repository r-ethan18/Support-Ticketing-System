from enum import StrEnum


class Role(StrEnum):
    requester = "requester"
    assignee = "assignee"
    supervisor = "supervisor"
    admin = "admin"


# NOTE: the ER diagram leaves the values of priority/status unspecified.
# These are placeholders - adjust once the workflow is agreed.
class TicketPriority(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class TicketStatus(StrEnum):
    open = "open"
    assigned = "assigned"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"


class AttachmentKind(StrEnum):
    issue_evidence = "issue_evidence"
    completion_proof = "completion_proof"


class SortOrder(StrEnum):
    asc = "asc"
    desc = "desc"


class TicketSortField(StrEnum):
    created_at = "createdAt"
    closed_at = "closedAt"
    priority = "priority"
