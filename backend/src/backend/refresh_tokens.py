"""Refresh tokens: long-lived, single-use, rotated on every refresh.

The access token is a short-lived JWT; a refresh token trades for a new pair
and re-reads the person's role, so role changes and deletions take effect at
the next refresh. Tokens are random strings stored only as a SHA-256 digest.
"""

import hashlib
import secrets
from typing import Protocol
from uuid import UUID, uuid4

from psycopg_pool import AsyncConnectionPool

from backend.config import get_settings
from backend.db import PoolDep
from backend.schemas.enums import Role


class RefreshTokenStore(Protocol):
    async def issue(self, person_id: UUID) -> str:
        """Start a new token family for `person_id`; return the token."""
        ...

    async def rotate(self, token: str) -> tuple[UUID, Role, str] | None:
        """Retire `token`; return `(person_id, current role, successor)`.

        `None` if the token is unknown, expired or revoked. Presenting an
        already-retired token revokes its whole family.
        """
        ...

    async def revoke(self, token: str) -> None:
        """Revoke the token's family (log out one session). Unknown is a no-op."""
        ...

    async def revoke_all(self, person_id: UUID) -> None:
        """Revoke every session of `person_id`."""
        ...


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class PostgresRefreshTokenStore:
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def _insert(self, conn, person_id: UUID, family_id: UUID) -> str:
        token = secrets.token_urlsafe(32)
        await conn.execute(
            "INSERT INTO refresh_token (family_id, person_id, token_hash, expires_at)"
            " VALUES (%s, %s, %s, now() + make_interval(secs => %s))",
            (
                family_id,
                person_id,
                _digest(token),
                get_settings().refresh_token_ttl_seconds,
            ),
        )
        return token

    async def issue(self, person_id: UUID) -> str:
        async with self._pool.connection() as conn:
            return await self._insert(conn, person_id, uuid4())

    async def rotate(self, token: str) -> tuple[UUID, Role, str] | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "SELECT id, family_id, person_id, revoked_at IS NOT NULL,"
                " expires_at <= now() FROM refresh_token WHERE token_hash = %s"
                " FOR UPDATE",
                (_digest(token),),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            token_id, family_id, person_id, revoked, expired = row
            if revoked:
                await conn.execute(
                    "UPDATE refresh_token SET revoked_at = now()"
                    " WHERE family_id = %s AND revoked_at IS NULL",
                    (family_id,),
                )
                return None
            if expired:
                return None
            await conn.execute(
                "UPDATE refresh_token SET revoked_at = now() WHERE id = %s",
                (token_id,),
            )
            cur = await conn.execute(
                "SELECT role FROM person WHERE id = %s", (person_id,)
            )
            person = await cur.fetchone()
            if person is None:  # unreachable: tokens cascade with the person
                return None
            return (
                person_id,
                Role(person[0]),
                await self._insert(conn, person_id, family_id),
            )

    async def revoke(self, token: str) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                "UPDATE refresh_token SET revoked_at = now() WHERE revoked_at IS NULL"
                " AND family_id = (SELECT family_id FROM refresh_token"
                " WHERE token_hash = %s)",
                (_digest(token),),
            )

    async def revoke_all(self, person_id: UUID) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                "UPDATE refresh_token SET revoked_at = now()"
                " WHERE person_id = %s AND revoked_at IS NULL",
                (person_id,),
            )


def get_refresh_token_store(pool: PoolDep) -> RefreshTokenStore:
    """FastAPI dependency."""
    return PostgresRefreshTokenStore(pool)
