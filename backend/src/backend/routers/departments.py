from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.auth import require_roles
from backend.cascade import remove_department
from backend.db import (
    PoolDep,
    fetch_or_404,
    fetch_page,
    insert_named,
    like_pattern,
)
from backend.errors import CONFLICT, FORBIDDEN, NOT_FOUND
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Department, DepartmentCreate, DepartmentPage
from backend.schemas.enums import Role

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("", summary="List departments")
async def list_departments(
    page: PaginationDep,
    pool: PoolDep,
    q: Annotated[str | None, Query(description="Match on name")] = None,
) -> DepartmentPage:
    """Owned assets: `GET /assets?departmentId=...`. Supervisors: `GET /people?departmentId=...`."""
    where, params = [], []
    if q:
        where.append("name ILIKE %s")
        params.append(like_pattern(q))
    items, total = await fetch_page(
        pool,
        Department,
        select="id, name FROM department",
        where=where,
        params=params,
        order_by="name, id",
        limit=page.limit,
        offset=page.offset,
    )
    return DepartmentPage(
        items=items, total=total, limit=page.limit, offset=page.offset
    )


@router.get("/{department_id}", summary="Get a department", responses=NOT_FOUND)
async def get_department(department_id: UUID, pool: PoolDep) -> Department:
    return await fetch_or_404(
        pool,
        Department,
        "SELECT id, name FROM department WHERE id = %s",
        [department_id],
        "Department",
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create a department (admin only)",
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**FORBIDDEN, **CONFLICT},
)
async def create_department(body: DepartmentCreate, pool: PoolDep) -> Department:
    return await insert_named(pool, Department, "department", body.name, "Department")


@router.delete(
    "/{department_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a department (admin only)",
    description=(
        "Fails with 409 while the department owns assets. Its supervisors become"
        " plain requesters."
    ),
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**NOT_FOUND, **FORBIDDEN, **CONFLICT},
)
async def delete_department(department_id: UUID, pool: PoolDep) -> None:
    async with pool.connection() as conn:
        if not await remove_department(conn, department_id):
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, detail="Department not found"
            )
