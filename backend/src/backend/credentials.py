"""Where login credentials come from.

Passwords live in Postgres (see `PERSON_CREDENTIAL` in ER.mmd). Nothing else in
the auth code knows that: the login route only needs a `CredentialStore`, so the
database layer can be added later without touching it.
"""

from typing import Protocol
from uuid import UUID

from psycopg.rows import class_row
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel

from backend.db import PoolDep
from backend.schemas.enums import Role


class Credential(BaseModel):
    person_id: UUID
    role: Role
    password_hash: str


class CredentialStore(Protocol):
    async def get_by_email(self, email: str) -> Credential | None:
        """Look up a person's credential. Emails compare case-insensitively."""
        ...


class PostgresCredentialStore:
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def get_by_email(self, email: str) -> Credential | None:
        async with (
            self._pool.connection() as conn,
            conn.cursor(row_factory=class_row(Credential)) as cur,
        ):
            await cur.execute(
                """
                SELECT p.id AS person_id, p.role, c.password_hash
                FROM person p
                JOIN person_credential c ON c.person_id = p.id
                WHERE lower(p.email) = lower(%s)
                """,
                (email,),
            )
            return await cur.fetchone()


def get_credential_store(pool: PoolDep) -> CredentialStore:
    """FastAPI dependency."""
    return PostgresCredentialStore(pool)
