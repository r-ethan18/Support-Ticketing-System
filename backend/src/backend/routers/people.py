from typing import Annotated
from uuid import UUID

import psycopg.errors
import psycopg.rows
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.accounts import PERSON_COLUMNS, create_person
from backend.auth import CurrentUserDep, require_roles
from backend.db import PoolDep, fetch_or_404, fetch_page, like_pattern
from backend.errors import CONFLICT, FORBIDDEN, NOT_FOUND
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Category
from backend.schemas.enums import Role
from backend.schemas.people import Person, PersonPage, StaffCreate

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
    category_id: Annotated[
        UUID | None,
        Query(
            alias="categoryId",
            description="Only assignees specialising in this category",
        ),
    ] = None,
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
    if category_id:
        where.append(
            "id IN (SELECT person_id FROM assignee_category WHERE category_id = %s)"
        )
        params.append(category_id)
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


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create a supervisor or assignee (admin only)",
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**FORBIDDEN, **CONFLICT},
)
async def create_staff(body: StaffCreate, pool: PoolDep) -> Person:
    person_id = await create_person(
        pool,
        name=body.name,
        email=body.email,
        phone=body.phone,
        password=body.password,
        role=body.role,
        vendor_id=body.vendor_id,
        department_id=body.department_id,
        category_ids=body.category_ids,
    )
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


@router.get(
    "/{person_id}/categories",
    summary="List the categories an assignee specialises in",
    responses={**NOT_FOUND, **FORBIDDEN},
)
async def list_person_categories(
    person_id: UUID, user: CurrentUserDep, pool: PoolDep
) -> list[Category]:
    await _visible_person(person_id, user, pool)
    async with (
        pool.connection() as conn,
        conn.cursor(row_factory=psycopg.rows.class_row(Category)) as cur,
    ):
        await cur.execute(
            "SELECT c.id, c.name FROM category c"
            " JOIN assignee_category ac ON ac.category_id = c.id"
            " WHERE ac.person_id = %s ORDER BY c.name, c.id",
            (person_id,),
        )
        return await cur.fetchall()
