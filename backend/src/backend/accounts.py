"""Creating and deleting people (and their password credentials)."""

from uuid import UUID

import psycopg.errors
from fastapi import HTTPException, status
from fastapi.concurrency import run_in_threadpool
from psycopg_pool import AsyncConnectionPool

from backend.config import get_settings
from backend.schemas.enums import Role
from backend.security import hash_password

# Everything `Person` exposes, in one place so every query returns the same shape.
PERSON_COLUMNS = (
    "id, name, email, coalesce(phone, '') AS phone, role, vendor_id, department_id"
)


async def create_person(
    pool: AsyncConnectionPool,
    *,
    name: str,
    email: str,
    phone: str,
    password: str,
    role: Role,
    vendor_id: UUID | None = None,
    department_id: UUID | None = None,
    category_ids: list[UUID] | None = None,
) -> UUID:
    """Insert a person, their credential and category links in one transaction.

    Raises 409 if the email is taken and 422 if a referenced vendor, department
    or category does not exist.
    """
    # Argon2 is CPU-bound; keep it off the event loop.
    password_hash = await run_in_threadpool(hash_password, password)
    try:
        async with pool.connection() as conn:
            cur = await conn.execute(
                "INSERT INTO person (name, email, phone, role, vendor_id, department_id)"
                " VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (name, email, phone, role.value, vendor_id, department_id),
            )
            row = await cur.fetchone()
            assert row is not None
            person_id: UUID = row[0]
            await conn.execute(
                "INSERT INTO person_credential (person_id, password_hash)"
                " VALUES (%s, %s)",
                (person_id, password_hash),
            )
            for category_id in dict.fromkeys(category_ids or []):
                await conn.execute(
                    "INSERT INTO assignee_category (person_id, category_id)"
                    " VALUES (%s, %s)",
                    (person_id, category_id),
                )
    except psycopg.errors.UniqueViolation:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Email is already registered"
        ) from None
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unknown vendor, department or category",
        ) from None
    return person_id


async def ensure_admin(pool: AsyncConnectionPool) -> None:
    """Create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if none exists.

    `POST /admins` needs an admin token, so without this nobody could ever log in
    to create one. Refuses to start (raises) if no admin exists and the settings
    are missing.
    """
    async with pool.connection() as conn:
        cur = await conn.execute("SELECT 1 FROM person WHERE role = 'admin' LIMIT 1")
        if await cur.fetchone():
            return
    settings = get_settings()
    if not settings.admin_email or not settings.admin_password:
        raise RuntimeError(
            "No admin account exists: set ADMIN_EMAIL and ADMIN_PASSWORD for the first run"
        )
    await create_person(
        pool,
        name="Administrator",
        email=settings.admin_email,
        phone="",
        password=settings.admin_password,
        role=Role.admin,
    )
