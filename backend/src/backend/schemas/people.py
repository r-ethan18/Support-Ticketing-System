from uuid import UUID

from pydantic import Field

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


class PersonPage(Page[Person]):
    pass
