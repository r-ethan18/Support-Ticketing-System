from uuid import UUID

from pydantic import Field, model_validator

from backend.schemas.base import CamelModel, Page
from backend.schemas.enums import Role


class Person(CamelModel):
    id: UUID
    name: str
    email: str
    phone: str
    role: Role
    vendor_id: UUID | None = None
    # Set for supervisors only ("DEPARTMENT ||--o{ PERSON : supervisors belong to").
    department_id: UUID | None = None


class AdminCreate(CamelModel):
    name: str
    email: str
    phone: str
    password: str = Field(min_length=12, max_length=128)


class RegisterRequest(CamelModel):
    """Self-service sign-up; always creates a `requester`."""

    name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    phone: str
    password: str = Field(min_length=12, max_length=128)


class StaffCreate(CamelModel):
    """Admin-created supervisor or assignee account."""

    name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    phone: str
    password: str = Field(min_length=12, max_length=128)
    role: Role
    vendor_id: UUID | None = Field(
        default=None, description="Employer, for assignees only"
    )
    department_id: UUID | None = Field(
        default=None, description="Required for supervisors, not allowed otherwise"
    )
    category_ids: list[UUID] = Field(
        default_factory=list,
        description="Categories an assignee specialises in (assignees only)",
    )

    @model_validator(mode="after")
    def _check_role_fields(self) -> StaffCreate:
        if self.role not in (Role.supervisor, Role.assignee):
            raise ValueError("role must be 'supervisor' or 'assignee'")
        if self.role is Role.supervisor:
            if self.department_id is None:
                raise ValueError("a supervisor needs a departmentId")
            if self.vendor_id is not None or self.category_ids:
                raise ValueError("vendorId and categoryIds are for assignees only")
        elif self.department_id is not None:
            raise ValueError("departmentId is for supervisors only")
        return self


class PersonPage(Page[Person]):
    pass
