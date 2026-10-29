from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from backend.db import PoolDep, fetch_or_404, fetch_page, like_pattern
from backend.errors import NOT_FOUND
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Asset, AssetPage

router = APIRouter(prefix="/assets", tags=["assets"])

COLUMNS = "id, name, department_id, category_id"


@router.get("", summary="List assets")
async def list_assets(
    page: PaginationDep,
    pool: PoolDep,
    department_id: Annotated[UUID | None, Query(alias="departmentId")] = None,
    category_id: Annotated[UUID | None, Query(alias="categoryId")] = None,
    q: Annotated[str | None, Query(description="Match on name")] = None,
) -> AssetPage:
    where: list[str] = []
    params: list[object] = []
    if department_id:
        where.append("department_id = %s")
        params.append(department_id)
    if category_id:
        where.append("category_id = %s")
        params.append(category_id)
    if q:
        where.append("name ILIKE %s")
        params.append(like_pattern(q))
    items, total = await fetch_page(
        pool,
        Asset,
        select=f"{COLUMNS} FROM asset",
        where=where,
        params=params,
        order_by="name, id",
        limit=page.limit,
        offset=page.offset,
    )
    return AssetPage(items=items, total=total, limit=page.limit, offset=page.offset)


@router.get("/{asset_id}", summary="Get an asset", responses=NOT_FOUND)
async def get_asset(asset_id: UUID, pool: PoolDep) -> Asset:
    """Tickets about an asset: `GET /tickets?assetId=...`."""
    return await fetch_or_404(
        pool, Asset, f"SELECT {COLUMNS} FROM asset WHERE id = %s", [asset_id], "Asset"
    )
