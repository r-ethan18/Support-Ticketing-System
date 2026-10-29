from typing import Annotated
from uuid import UUID

import psycopg.errors
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.auth import CurrentUser, CurrentUserDep, require_roles
from backend.db import (
    PoolDep,
    delete_by_id,
    fetch_one,
    fetch_or_404,
    fetch_page,
    like_pattern,
)
from backend.errors import CONFLICT, FORBIDDEN, NOT_FOUND
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Asset, AssetCreate, AssetPage, AssetUpdate
from backend.schemas.enums import Role

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


supervisor_only = Depends(require_roles(Role.supervisor))


async def _own_department(user: CurrentUser, pool: PoolDep) -> UUID | None:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT department_id FROM person WHERE id = %s", (user.id,)
        )
        row = await cur.fetchone()
    return row[0] if row else None


async def authorize_department(
    user: CurrentUser, pool: PoolDep, department_id: UUID | None
) -> UUID:
    """The department `user` may manage assets in, given what they asked for.

    Admins manage any department but must name it; supervisors only their own.
    """
    if user.role is Role.admin:
        if department_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="departmentId is required",
            )
        return department_id
    own = await _own_department(user, pool)
    if own is None or department_id not in (None, own):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="You can only manage assets of your own department",
        )
    return own


async def get_manageable_asset(
    asset_id: UUID, user: CurrentUser, pool: PoolDep
) -> Asset:
    """The asset, if `user` may change it (404 if absent, 403 if another department's)."""
    asset = await fetch_or_404(
        pool, Asset, f"SELECT {COLUMNS} FROM asset WHERE id = %s", [asset_id], "Asset"
    )
    await authorize_department(user, pool, asset.department_id)
    return asset


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create an asset (supervisor or admin)",
    description="Supervisors create assets in their own department.",
    dependencies=[supervisor_only],
    responses=FORBIDDEN,
)
async def create_asset(body: AssetCreate, user: CurrentUserDep, pool: PoolDep) -> Asset:
    department_id = await authorize_department(user, pool, body.department_id)
    try:
        asset = await fetch_one(
            pool,
            Asset,
            f"INSERT INTO asset (name, department_id, category_id) VALUES (%s, %s, %s)"
            f" RETURNING {COLUMNS}",
            [body.name, department_id, body.category_id],
        )
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unknown departmentId or categoryId",
        ) from None
    assert asset is not None
    return asset


@router.patch(
    "/{asset_id}",
    summary="Update an asset (supervisor or admin)",
    dependencies=[supervisor_only],
    responses={**NOT_FOUND, **FORBIDDEN},
)
async def update_asset(
    asset_id: UUID, body: AssetUpdate, user: CurrentUserDep, pool: PoolDep
) -> Asset:
    asset = await get_manageable_asset(asset_id, user, pool)
    try:
        updated = await fetch_one(
            pool,
            Asset,
            "UPDATE asset SET name = %s, category_id = %s WHERE id = %s"
            f" RETURNING {COLUMNS}",
            [body.name or asset.name, body.category_id or asset.category_id, asset_id],
        )
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown categoryId"
        ) from None
    assert updated is not None
    return updated


@router.delete(
    "/{asset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an asset (supervisor or admin)",
    description="Fails with 409 while tickets refer to the asset.",
    dependencies=[supervisor_only],
    responses={**NOT_FOUND, **FORBIDDEN, **CONFLICT},
)
async def delete_asset(asset_id: UUID, user: CurrentUserDep, pool: PoolDep) -> None:
    await get_manageable_asset(asset_id, user, pool)
    await delete_by_id(pool, "asset", asset_id, "Asset")
