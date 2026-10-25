from fastapi import APIRouter

from backend.auth import CurrentUserDep
from backend.errors import UNAUTHORIZED, not_implemented
from backend.schemas.auth import TokenRequest, TokenResponse
from backend.schemas.people import Person

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/token",
    summary="Exchange credentials for an access token",
    responses={401: UNAUTHORIZED[401]},
)
async def create_access_token(body: TokenRequest) -> TokenResponse:
    """Public endpoint. Send the returned token as `Authorization: Bearer <token>`."""
    not_implemented()


@router.get("/me", summary="Get the authenticated person", responses=UNAUTHORIZED)
async def get_me(user: CurrentUserDep) -> Person:
    not_implemented()
