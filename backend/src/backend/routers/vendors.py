from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from backend.errors import NOT_FOUND, not_implemented
from backend.routers.deps import PaginationDep
from backend.schemas.assets import Vendor, VendorPage

router = APIRouter(prefix="/vendors", tags=["vendors"])


@router.get("", summary="List vendors")
async def list_vendors(
    page: PaginationDep,
    q: Annotated[str | None, Query(description="Match on name")] = None,
) -> VendorPage:
    """Employees of a vendor: `GET /people?vendorId=...`."""
    not_implemented()


@router.get("/{vendor_id}", summary="Get a vendor", responses=NOT_FOUND)
async def get_vendor(vendor_id: UUID) -> Vendor:
    not_implemented()
