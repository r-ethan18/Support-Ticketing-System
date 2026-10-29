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


class RoleAssignment(CamelModel):
    """What an admin sets on an existing person."""

    role: Role
    vendor_id: UUID | None = Field(
        default=None, description="Employer; required for assignees"
    )
    department_id: UUID | None = Field(
        default=None, description="Required for supervisors"
    )

    @model_validator(mode="after")
    def _check_role_fields(self) -> RoleAssignment:
        if self.role is Role.admin:
            raise ValueError("use POST /admins to create admins")
        if (self.role is Role.supervisor) != (self.department_id is not None):
            raise ValueError("departmentId is required for, and only for, supervisors")
        if (self.role is Role.assignee) != (self.vendor_id is not None):
            raise ValueError("vendorId is required for, and only for, assignees")
        return self


class PersonPage(Page[Person]):
    pass
