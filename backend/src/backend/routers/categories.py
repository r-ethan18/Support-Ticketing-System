from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from backend.errors import NOT_FOUND, not_implemented
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Category, CategoryPage

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", summary="List categories")
async def list_categories(
    page: PaginationDep,
    q: Annotated[str | None, Query(description="Match on name")] = None,
) -> CategoryPage:
    """Specialised assignees: `GET /people?categoryId=...`. Assets: `GET /assets?categoryId=...`."""
    not_implemented()


@router.get("/{category_id}", summary="Get a category", responses=NOT_FOUND)
async def get_category(category_id: UUID) -> Category:
    not_implemented()
