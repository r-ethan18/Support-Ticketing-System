from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from backend.accounts import PERSON_COLUMNS, create_person
from backend.auth import CurrentUserDep
from backend.credentials import CredentialStore, get_credential_store
from backend.db import PoolDep, fetch_or_404
from backend.errors import CONFLICT, UNAUTHORIZED
from backend.schemas.auth import TokenRequest, TokenResponse
from backend.schemas.enums import Role
from backend.schemas.people import Person, RegisterRequest
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


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    summary="Create a requester account",
    description="Public self-service sign-up. Always creates a `requester`.",
    responses=CONFLICT,
)
async def register(body: RegisterRequest, pool: PoolDep) -> Person:
    person_id = await create_person(
        pool,
        name=body.name,
        email=body.email,
        phone=body.phone,
        password=body.password,
        role=Role.requester,
    )
    return await fetch_or_404(
        pool,
        Person,
        f"SELECT {PERSON_COLUMNS} FROM person WHERE id = %s",
        [person_id],
        "Person",
    )


@router.get("/me", summary="Get the authenticated person", responses=UNAUTHORIZED)
async def get_me(user: CurrentUserDep, pool: PoolDep) -> Person:
    return await fetch_or_404(
        pool,
        Person,
        f"SELECT {PERSON_COLUMNS} FROM person WHERE id = %s",
        [user.id],
        "Person",
    )
