from fastapi import APIRouter, Depends, status

from backend.auth import require_roles
from backend.errors import CONFLICT, FORBIDDEN, not_implemented
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
async def create_admin(body: AdminCreate) -> Person:
    not_implemented()
