"""Postgres connection pool, owned by the app's lifespan."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from psycopg_pool import AsyncConnectionPool

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
        app.state.db_pool = pool
        yield
    finally:
        await pool.close()


def get_pool(request: Request) -> AsyncConnectionPool:
    return request.app.state.db_pool


PoolDep = Annotated[AsyncConnectionPool, Depends(get_pool)]
