from typing import Annotated
from uuid import UUID

import psycopg.errors
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.accounts import PERSON_COLUMNS
from backend.auth import CurrentUserDep, require_roles
from backend.db import PoolDep, fetch_or_404, fetch_page, like_pattern
from backend.errors import CONFLICT, FORBIDDEN, NOT_FOUND
from backend.routers.deps import PaginationDep
from backend.schemas.enums import Role
from backend.schemas.people import Person, PersonPage, RoleAssignment

router = APIRouter(prefix="/people", tags=["people"])

STAFF_ROLES = (Role.supervisor, Role.assignee)


@router.get(
    "",
    summary="List people (supervisor or admin)",
    dependencies=[Depends(require_roles(Role.supervisor))],
    responses=FORBIDDEN,
)
async def list_people(
    page: PaginationDep,
    pool: PoolDep,
    role: Annotated[Role | None, Query()] = None,
    vendor_id: Annotated[UUID | None, Query(alias="vendorId")] = None,
    department_id: Annotated[UUID | None, Query(alias="departmentId")] = None,
    q: Annotated[str | None, Query(description="Match on name or email")] = None,
) -> PersonPage:
    where: list[str] = []
    params: list[object] = []
    if role:
        where.append("role = %s")
        params.append(role.value)
    if vendor_id:
        where.append("vendor_id = %s")
        params.append(vendor_id)
    if department_id:
        where.append("department_id = %s")
        params.append(department_id)
    if q:
        where.append("(name ILIKE %s OR email ILIKE %s)")
        params += [like_pattern(q)] * 2
    items, total = await fetch_page(
        pool,
        Person,
        select=f"{PERSON_COLUMNS} FROM person",
        where=where,
        params=params,
        order_by="name, id",
        limit=page.limit,
        offset=page.offset,
    )
    return PersonPage(items=items, total=total, limit=page.limit, offset=page.offset)


@router.put(
    "/{person_id}/role",
    summary="Assign a person's role (admin only)",
    description=(
        "Everyone signs up as a `requester`; an admin promotes them. A `supervisor`"
        " needs a `departmentId`; an `assignee` (a vendor's technician) needs a"
        " `vendorId`. Setting `requester` clears both. Admin accounts are created"
        " with `POST /admins` and their role cannot be changed here. The person's"
        " current access token keeps its old role until it expires."
    ),
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**NOT_FOUND, **FORBIDDEN, **CONFLICT},
)
async def assign_role(person_id: UUID, body: RoleAssignment, pool: PoolDep) -> Person:
    person = await fetch_or_404(
        pool,
        Person,
        f"SELECT {PERSON_COLUMNS} FROM person WHERE id = %s",
        [person_id],
        "Person",
    )
    if person.role is Role.admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="An admin's role cannot be changed"
        )
    try:
        async with pool.connection() as conn:
            if person.role is Role.assignee and (
                body.role is not Role.assignee or body.vendor_id != person.vendor_id
            ):
                cur = await conn.execute(
                    "SELECT 1 FROM ticket_assignment"
                    " WHERE assignee_id = %s AND unassigned_at IS NULL LIMIT 1",
                    (person_id,),
                )
                if await cur.fetchone():
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        detail="Unassign this person from their tickets first",
                    )
            await conn.execute(
                "UPDATE person SET role = %s, department_id = %s, vendor_id = %s"
                " WHERE id = %s",
                (body.role.value, body.department_id, body.vendor_id, person_id),
            )
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unknown vendorId or departmentId",
        ) from None
    return await fetch_or_404(
        pool,
        Person,
        f"SELECT {PERSON_COLUMNS} FROM person WHERE id = %s",
        [person_id],
        "Person",
    )


async def _visible_person(
    person_id: UUID, user: CurrentUserDep, pool: PoolDep
) -> Person:
    """The person, if `user` may see them (404 if absent, 403 if hidden).

    Requesters' details are private: only they, supervisors and admins can read
    them. Staff profiles are visible to everyone so people can see who is
    handling their ticket.
    """
    person = await fetch_or_404(
        pool,
        Person,
        f"SELECT {PERSON_COLUMNS} FROM person WHERE id = %s",
        [person_id],
        "Person",
    )
    if (
        person.role is Role.requester
        and person.id != user.id
        and user.role not in (Role.supervisor, Role.admin)
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Insufficient role")
    return person


@router.get(
    "/{person_id}",
    summary="Get a person",
    responses={**NOT_FOUND, **FORBIDDEN},
)
async def get_person(person_id: UUID, user: CurrentUserDep, pool: PoolDep) -> Person:
    return await _visible_person(person_id, user, pool)


@router.delete(
    "/{person_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a supervisor or assignee (admin only)",
    description=(
        "Requesters and admins cannot be deleted here. An assignee who appears in a"
        " ticket's assignment history cannot be deleted (409)."
    ),
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**NOT_FOUND, **FORBIDDEN, **CONFLICT},
)
async def delete_person(person_id: UUID, pool: PoolDep) -> None:
    person = await fetch_or_404(
        pool,
        Person,
        f"SELECT {PERSON_COLUMNS} FROM person WHERE id = %s",
        [person_id],
        "Person",
    )
    if person.role not in STAFF_ROLES:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only supervisor and assignee accounts can be deleted",
        )
    try:
        async with pool.connection() as conn:
            await conn.execute("DELETE FROM person WHERE id = %s", (person_id,))
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Person is referenced by existing tickets and cannot be deleted",
        ) from None
