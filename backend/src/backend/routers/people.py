from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from backend.errors import NOT_FOUND, not_implemented
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Category
from backend.schemas.enums import Role
from backend.schemas.people import Person, PersonPage

router = APIRouter(prefix="/people", tags=["people"])


@router.get("", summary="List people")
async def list_people(
    page: PaginationDep,
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
    not_implemented()


@router.get("/{person_id}", summary="Get a person", responses=NOT_FOUND)
async def get_person(person_id: UUID) -> Person:
    not_implemented()


@router.get(
    "/{person_id}/categories",
    summary="List the categories an assignee specialises in",
    responses=NOT_FOUND,
)
async def list_person_categories(person_id: UUID) -> list[Category]:
    not_implemented()
