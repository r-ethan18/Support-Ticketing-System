from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from backend.auth import CurrentUserDep
from backend.credentials import CredentialStore, get_credential_store
from backend.errors import UNAUTHORIZED, not_implemented
from backend.schemas.auth import TokenRequest, TokenResponse
from backend.schemas.people import Person
from backend.security import encode_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/token",
    summary="Exchange credentials for an access token",
    responses={401: UNAUTHORIZED[401]},
)
async def create_access_token(
    body: TokenRequest,
    store: Annotated[CredentialStore, Depends(get_credential_store)],
) -> TokenResponse:
    """Public endpoint. Send the returned token as `Authorization: Bearer <token>`."""
    credential = await store.get_by_email(body.email)
    # Argon2 is CPU-bound; keep it off the event loop.
    password_ok = await run_in_threadpool(
        verify_password,
        body.password,
        credential.password_hash if credential else None,
    )
    if credential is None or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token, expires_in = encode_access_token(credential.person_id, credential.role)
    return TokenResponse(access_token=token, expires_in=expires_in)


@router.get("/me", summary="Get the authenticated person", responses=UNAUTHORIZED)
async def get_me(user: CurrentUserDep) -> Person:
    not_implemented()
