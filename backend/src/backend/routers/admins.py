from fastapi import APIRouter, Depends, status

from backend.accounts import PERSON_COLUMNS, create_person
from backend.auth import require_roles
from backend.db import PoolDep, fetch_or_404
from backend.errors import CONFLICT, FORBIDDEN
from backend.schemas.enums import Role
from backend.schemas.people import AdminCreate, Person

router = APIRouter(prefix="/admins", tags=["admins"])


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create an admin (admin only)",
    description="Creates a person with role `admin` and the given password.",
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**FORBIDDEN, **CONFLICT},
)
async def create_admin(body: AdminCreate, pool: PoolDep) -> Person:
    person_id = await create_person(
        pool,
        name=body.name,
        email=body.email,
        phone=body.phone,
        password=body.password,
        role=Role.admin,
    )
    return await fetch_or_404(
        pool,
        Person,
        f"SELECT {PERSON_COLUMNS} FROM person WHERE id = %s",
        [person_id],
        "Person",
    )
