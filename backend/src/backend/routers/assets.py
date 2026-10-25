from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from backend.errors import NOT_FOUND, not_implemented
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Asset, AssetPage

router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("", summary="List assets")
async def list_assets(
    page: PaginationDep,
    department_id: Annotated[UUID | None, Query(alias="departmentId")] = None,
    category_id: Annotated[UUID | None, Query(alias="categoryId")] = None,
    q: Annotated[str | None, Query(description="Match on name")] = None,
) -> AssetPage:
    not_implemented()


@router.get("/{asset_id}", summary="Get an asset", responses=NOT_FOUND)
async def get_asset(asset_id: UUID) -> Asset:
    """Tickets about an asset: `GET /tickets?assetId=...`."""
    not_implemented()
