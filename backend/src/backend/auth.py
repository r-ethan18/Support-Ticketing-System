"""Access-token authentication.

Every route except `POST /auth/token` depends on `get_current_user`, so the
OpenAPI spec advertises a bearer-token security scheme and the frontend can
send `Authorization: Bearer <accessToken>`.
"""

from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from backend.schemas.enums import Role
from backend.security import InvalidAccessToken, decode_access_token

bearer_scheme = HTTPBearer(
    scheme_name="AccessToken",
    description="Access token obtained from `POST /api/v1/auth/token`.",
    auto_error=False,
)


class CurrentUser(BaseModel):
    """The caller, as resolved from the access token's claims."""

    id: UUID
    role: Role


def verify_access_token(token: str) -> CurrentUser:
    """Validate `token` and return the caller. Raise 401 if it is invalid/expired.

    Stateless: the role comes from the token, so a role change only takes effect
    once the person's current token expires.
    """
    try:
        person_id, role = decode_access_token(token)
    except InvalidAccessToken:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
    return CurrentUser(id=person_id, role=role)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> CurrentUser:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return verify_access_token(credentials.credentials)


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_roles(*roles: Role) -> Callable[..., CurrentUser]:
    """Dependency factory: allow only callers whose role is in `roles`.

    `admin` always passes, so new role-gated routes need no admin special-casing.
    """

    async def dependency(user: CurrentUserDep) -> CurrentUser:
        if user.role is not Role.admin and user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role"
            )
        return user

    return dependency
