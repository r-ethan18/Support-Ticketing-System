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
from backend.schemas.assets import Vendor, VendorCreate, VendorPage
from backend.schemas.enums import Role

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


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create a vendor (admin only)",
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**FORBIDDEN, **CONFLICT},
)
async def create_vendor(body: VendorCreate, pool: PoolDep) -> Vendor:
    return await insert_named(pool, Vendor, "vendor", body.name, "Vendor")


@router.delete(
    "/{vendor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a vendor (admin only)",
    description="Fails with 409 while people, assets or tickets still refer to it.",
    dependencies=[Depends(require_roles(Role.admin))],
    responses={**NOT_FOUND, **FORBIDDEN, **CONFLICT},
)
async def delete_vendor(vendor_id: UUID, pool: PoolDep) -> None:
    await delete_by_id(pool, "vendor", vendor_id, "Vendor")
