from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool

from backend.accounts import PERSON_COLUMNS, create_person
from backend.auth import CurrentUserDep
from backend.credentials import CredentialStore, get_credential_store
from backend.db import PoolDep, fetch_or_404
from backend.errors import CONFLICT, UNAUTHORIZED
from backend.refresh_tokens import RefreshTokenStore, get_refresh_token_store
from backend.schemas.auth import (
    PasswordChange,
    RefreshRequest,
    TokenRequest,
    TokenResponse,
)
from backend.schemas.enums import Role
from backend.schemas.people import Person, RegisterRequest
from backend.security import encode_access_token, hash_password, verify_password
from backend.throttle import ThrottleDep, login_keys

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/token",
    summary="Exchange credentials for an access token",
    responses={
        401: UNAUTHORIZED[401],
        429: {"description": "Too many failed attempts; see `Retry-After`"},
    },
)
async def create_access_token(
    body: TokenRequest,
    request: Request,
    store: Annotated[CredentialStore, Depends(get_credential_store)],
    throttle: ThrottleDep,
    refresh_tokens: Annotated[RefreshTokenStore, Depends(get_refresh_token_store)],
) -> TokenResponse:
    """Public endpoint. Send the returned token as `Authorization: Bearer <token>`.

    Repeated failures for the same account and client address are locked out
    for a while (429).
    """
    keys = login_keys(request, body.email)
    await throttle.check(keys)
    credential = await store.get_by_email(body.email)
    # Argon2 is CPU-bound; keep it off the event loop.
    password_ok = await run_in_threadpool(
        verify_password,
        body.password,
        credential.password_hash if credential else None,
    )
    if credential is None or not password_ok:
        await throttle.record_failure(keys)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    await throttle.record_success(keys)
    token, expires_in = encode_access_token(credential.person_id, credential.role)
    return TokenResponse(
        access_token=token,
        refresh_token=await refresh_tokens.issue(credential.person_id),
        expires_in=expires_in,
    )


@router.post(
    "/refresh",
    summary="Exchange a refresh token for a new token pair",
    description=(
        "Refresh tokens are single-use: the response carries a replacement. The"
        " new access token has the person's *current* role. Sending a token that"
        " was already used revokes that whole session."
    ),
    responses={401: UNAUTHORIZED[401]},
)
async def refresh_access_token(
    body: RefreshRequest,
    refresh_tokens: Annotated[RefreshTokenStore, Depends(get_refresh_token_store)],
) -> TokenResponse:
    rotated = await refresh_tokens.rotate(body.refresh_token)
    if rotated is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )
    person_id, role, refresh_token = rotated
    token, expires_in = encode_access_token(person_id, role)
    return TokenResponse(
        access_token=token, refresh_token=refresh_token, expires_in=expires_in
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke a refresh token's session",
    description="Idempotent. Access tokens already issued stay valid until they expire.",
)
async def logout(
    body: RefreshRequest,
    refresh_tokens: Annotated[RefreshTokenStore, Depends(get_refresh_token_store)],
) -> None:
    await refresh_tokens.revoke(body.refresh_token)


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


@router.post(
    "/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change the authenticated person's password",
    description="Revokes all of the person's refresh tokens, so other devices must log in again.",
    responses={
        **UNAUTHORIZED,
        400: {"description": "Current password is wrong, or the new one is unchanged"},
        429: {"description": "Too many wrong current passwords; see `Retry-After`"},
    },
)
async def change_password(
    body: PasswordChange,
    user: CurrentUserDep,
    pool: PoolDep,
    throttle: ThrottleDep,
    refresh_tokens: Annotated[RefreshTokenStore, Depends(get_refresh_token_store)],
) -> None:
    keys = [f"password:{user.id}"]
    await throttle.check(keys)
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT password_hash FROM person_credential WHERE person_id = %s",
            (user.id,),
        )
        row = await cur.fetchone()
    if row is None:
        # Token for a person who has since been deleted.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    current_hash: str = row[0]
    if not await run_in_threadpool(
        verify_password, body.current_password, current_hash
    ):
        await throttle.record_failure(keys)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
        )
    await throttle.record_success(keys)
    if body.new_password == body.current_password:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="New password must differ from the current one",
        )
    new_hash = await run_in_threadpool(hash_password, body.new_password)
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE person_credential SET password_hash = %s, updated_at = now()"
            " WHERE person_id = %s",
            (new_hash, user.id),
        )
    # Sign out every session; their access tokens lapse within minutes.
    await refresh_tokens.revoke_all(user.id)
