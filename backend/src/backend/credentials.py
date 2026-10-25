"""Where login credentials come from.

Passwords live in Postgres (see `PERSON_CREDENTIAL` in ER.mmd). Nothing else in
the auth code knows that: the login route only needs a `CredentialStore`, so the
database layer can be added later without touching it.
"""

from typing import Protocol
from uuid import UUID

from pydantic import BaseModel

from backend.errors import not_implemented
from backend.schemas.enums import Role


class Credential(BaseModel):
    person_id: UUID
    role: Role
    password_hash: str


class CredentialStore(Protocol):
    async def get_by_email(self, email: str) -> Credential | None:
        """Look up a person's credential. Emails compare case-insensitively."""
        ...


def get_credential_store() -> CredentialStore:
    """FastAPI dependency. TODO: return the Postgres-backed store."""
    not_implemented()
