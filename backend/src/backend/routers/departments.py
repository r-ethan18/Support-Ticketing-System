from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from backend.errors import NOT_FOUND, not_implemented
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Department, DepartmentPage

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("", summary="List departments")
async def list_departments(
    page: PaginationDep,
    q: Annotated[str | None, Query(description="Match on name")] = None,
) -> DepartmentPage:
    """Owned assets: `GET /assets?departmentId=...`. Supervisors: `GET /people?departmentId=...`."""
    not_implemented()


@router.get("/{department_id}", summary="Get a department", responses=NOT_FOUND)
async def get_department(department_id: UUID) -> Department:
    not_implemented()
