from uuid import UUID

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


class PersonPage(Page[Person]):
    pass
