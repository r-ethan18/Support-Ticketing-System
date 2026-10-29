from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from backend.db import PoolDep, fetch_or_404, fetch_page, like_pattern
from backend.errors import NOT_FOUND
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Department, DepartmentPage

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
