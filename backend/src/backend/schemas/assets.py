from uuid import UUID

from pydantic import Field

from backend.schemas.base import CamelModel, Page

# NOTE: the ER diagram draws VENDOR, DEPARTMENT, CATEGORY and ASSET but lists no
# attributes for them. The fields below are the minimum implied by the
# relationships and are placeholders.


class Vendor(CamelModel):
    id: UUID
    name: str


class Department(CamelModel):
    id: UUID
    name: str


class Category(CamelModel):
    id: UUID
    name: str


class Asset(CamelModel):
    id: UUID
    name: str
    department_id: UUID
    category_id: UUID


class VendorPage(Page[Vendor]):
    pass


class DepartmentPage(Page[Department]):
    pass


class CategoryPage(Page[Category]):
    pass


class AssetPage(Page[Asset]):
    pass


class VendorCreate(CamelModel):
    name: str = Field(min_length=1, max_length=200)


class DepartmentCreate(CamelModel):
    name: str = Field(min_length=1, max_length=200)


class CategoryCreate(CamelModel):
    name: str = Field(min_length=1, max_length=200)
