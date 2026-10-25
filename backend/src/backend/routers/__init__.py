from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.errors import UNAUTHORIZED
from backend.routers import (
    admins,
    assets,
    auth,
    categories,
    departments,
    people,
    tickets,
    vendors,
)

# Everything below requires a valid access token.
protected = APIRouter(
    dependencies=[Depends(get_current_user)],
    responses=UNAUTHORIZED,
)
for module in (admins, people, vendors, departments, categories, assets, tickets):
    protected.include_router(module.router)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(
    auth.router
)  # public: /auth/token (and /auth/me, which self-protects)
api_router.include_router(protected)
