"""Postgres connection pool, owned by the app's lifespan."""

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request, status
from psycopg.rows import class_row
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel

from backend.accounts import ensure_admin
from backend.config import get_settings

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


async def init_schema(pool: AsyncConnectionPool) -> None:
    async with pool.connection() as conn:
        await conn.execute(SCHEMA_PATH.read_text())


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = AsyncConnectionPool(
        get_settings().database.conninfo, open=False, name="backend"
    )
    # Fail fast if Postgres is unreachable instead of serving 500s.
    await pool.open(wait=True, timeout=30)
    try:
        await init_schema(pool)
        await ensure_admin(pool)
        app.state.db_pool = pool
        yield
    finally:
        await pool.close()


def get_pool(request: Request) -> AsyncConnectionPool:
    return request.app.state.db_pool


PoolDep = Annotated[AsyncConnectionPool, Depends(get_pool)]


def like_pattern(text: str) -> str:
    """Turn user input into a case-insensitive substring `ILIKE` pattern."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def fetch_page[T: BaseModel](
    pool: AsyncConnectionPool,
    model: type[T],
    *,
    select: str,
    where: list[str],
    params: list[Any],
    order_by: str,
    limit: int,
    offset: int,
) -> tuple[list[T], int]:
    """Run a filtered, ordered, paginated query; return `(items, total)`.

    `select` is `"<columns> FROM <tables>"`; `where` holds parameterised
    conditions (callers never interpolate user input into them).
    """
    clause = f" WHERE {' AND '.join(where)}" if where else ""
    async with pool.connection() as conn:
        async with conn.cursor(row_factory=class_row(model)) as cur:
            await cur.execute(
                f"SELECT {select}{clause} ORDER BY {order_by} LIMIT %s OFFSET %s",
                [*params, limit, offset],
            )
            items = await cur.fetchall()
        from_part = select.split(" FROM ", 1)[1]
        cur = await conn.execute(f"SELECT count(*) FROM {from_part}{clause}", params)
        row = await cur.fetchone()
    return items, row[0] if row else 0


async def fetch_one[T: BaseModel](
    pool: AsyncConnectionPool, model: type[T], sql: str, params: Sequence[Any]
) -> T | None:
    async with (
        pool.connection() as conn,
        conn.cursor(row_factory=class_row(model)) as cur,
    ):
        await cur.execute(sql, params)
        return await cur.fetchone()


async def fetch_or_404[T: BaseModel](
    pool: AsyncConnectionPool,
    model: type[T],
    sql: str,
    params: Sequence[Any],
    what: str,
) -> T:
    found = await fetch_one(pool, model, sql, params)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{what} not found")
    return found
