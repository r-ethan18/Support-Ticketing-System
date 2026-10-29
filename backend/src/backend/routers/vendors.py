from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from backend.db import PoolDep, fetch_or_404, fetch_page, like_pattern
from backend.errors import NOT_FOUND
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Vendor, VendorPage

router = APIRouter(prefix="/vendors", tags=["vendors"])


@router.get("", summary="List vendors")
async def list_vendors(
    page: PaginationDep,
    pool: PoolDep,
    q: Annotated[str | None, Query(description="Match on name")] = None,
) -> VendorPage:
    """Employees of a vendor: `GET /people?vendorId=...`."""
    where, params = [], []
    if q:
        where.append("name ILIKE %s")
        params.append(like_pattern(q))
    items, total = await fetch_page(
        pool,
        Vendor,
        select="id, name FROM vendor",
        where=where,
        params=params,
        order_by="name, id",
        limit=page.limit,
        offset=page.offset,
    )
    return VendorPage(items=items, total=total, limit=page.limit, offset=page.offset)


@router.get("/{vendor_id}", summary="Get a vendor", responses=NOT_FOUND)
async def get_vendor(vendor_id: UUID, pool: PoolDep) -> Vendor:
    return await fetch_or_404(
        pool, Vendor, "SELECT id, name FROM vendor WHERE id = %s", [vendor_id], "Vendor"
    )
