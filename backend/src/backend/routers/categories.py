from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from backend.auth import require_roles
from backend.db import (
    PoolDep,
    delete_by_id,
    fetch_or_404,
    fetch_page,
    insert_named,
    like_pattern,
)
from backend.errors import CONFLICT, FORBIDDEN, NOT_FOUND
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Category, CategoryCreate, CategoryPage
from backend.schemas.enums import Role

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


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create a category (admin only)",
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**FORBIDDEN, **CONFLICT},
)
async def create_category(body: CategoryCreate, pool: PoolDep) -> Category:
    return await insert_named(pool, Category, "category", body.name, "Category")


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a category (admin only)",
    description="Fails with 409 while people, assets or tickets still refer to it.",
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**NOT_FOUND, **FORBIDDEN, **CONFLICT},
)
async def delete_category(category_id: UUID, pool: PoolDep) -> None:
    await delete_by_id(pool, "category", category_id, "Category")
