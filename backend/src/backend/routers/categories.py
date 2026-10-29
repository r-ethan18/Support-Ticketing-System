from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from backend.db import PoolDep, fetch_or_404, fetch_page, like_pattern
from backend.errors import NOT_FOUND
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Category, CategoryPage

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", summary="List categories")
async def list_categories(
    page: PaginationDep,
    pool: PoolDep,
    q: Annotated[str | None, Query(description="Match on name")] = None,
) -> CategoryPage:
    """Specialised assignees: `GET /people?categoryId=...`. Assets: `GET /assets?categoryId=...`."""
    where, params = [], []
    if q:
        where.append("name ILIKE %s")
        params.append(like_pattern(q))
    items, total = await fetch_page(
        pool,
        Category,
        select="id, name FROM category",
        where=where,
        params=params,
        order_by="name, id",
        limit=page.limit,
        offset=page.offset,
    )
    return CategoryPage(items=items, total=total, limit=page.limit, offset=page.offset)


@router.get("/{category_id}", summary="Get a category", responses=NOT_FOUND)
async def get_category(category_id: UUID, pool: PoolDep) -> Category:
    return await fetch_or_404(
        pool,
        Category,
        "SELECT id, name FROM category WHERE id = %s",
        [category_id],
        "Category",
    )
