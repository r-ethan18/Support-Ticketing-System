"""Failed-attempt throttling for password checks.

Counters live in Postgres so they hold across replicas and restarts. After
`login_max_failures` failures on one key inside the window, that key is locked
for `login_lockout_seconds` and callers get 429 with `Retry-After`.

Keys pair the account with the client address, so someone elsewhere cannot lock
a victim out by guessing at their email; a second per-address key caps how many
accounts one address may probe. Behind a proxy, set uvicorn's
`FORWARDED_ALLOW_IPS` so `request.client` is the real client, not the proxy.
"""

import math
from typing import Annotated, Protocol

from fastapi import Depends, HTTPException, Request, status
from psycopg_pool import AsyncConnectionPool

from backend.config import get_settings
from backend.db import PoolDep

# One address may fail this many times (across accounts) before it is locked.
ADDRESS_FAILURE_MULTIPLIER = 6


class Throttle(Protocol):
    async def check(self, keys: list[str]) -> None:
        """Raise 429 if any key is currently locked."""
        ...

    async def record_failure(self, keys: list[str]) -> None: ...

    async def record_success(self, keys: list[str]) -> None: ...


def login_keys(request: Request, email: str) -> list[str]:
    address = request.client.host if request.client else "unknown"
    return [f"login:{email.lower()}|{address}", f"login-ip:{address}"]


class PostgresThrottle:
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    def _limit(self, key: str) -> int:
        limit = get_settings().login_max_failures
        return (
            limit * ADDRESS_FAILURE_MULTIPLIER if key.startswith("login-ip:") else limit
        )

    async def check(self, keys: list[str]) -> None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "SELECT max(extract(epoch FROM locked_until - now()))"
                " FROM login_throttle WHERE key = ANY(%s) AND locked_until > now()",
                (keys,),
            )
            row = await cur.fetchone()
        if row and row[0]:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed attempts; try again later",
                headers={"Retry-After": str(math.ceil(row[0]))},
            )

    async def record_failure(self, keys: list[str]) -> None:
        settings = get_settings()
        async with self._pool.connection() as conn:
            for key in keys:
                params = {
                    "key": key,
                    "limit": self._limit(key),
                    "lockout": settings.login_lockout_seconds,
                    "window": settings.login_window_seconds,
                }
                # Forget a row whose window or lock has run out, then count.
                await conn.execute(
                    """
                    DELETE FROM login_throttle
                    WHERE key = %(key)s AND (
                        window_started_at < now() - make_interval(secs => %(window)s)
                        OR locked_until <= now()
                    )
                    """,
                    params,
                )
                await conn.execute(
                    """
                    INSERT INTO login_throttle AS t (key, failures, window_started_at)
                    VALUES (%(key)s, 1, now())
                    ON CONFLICT (key) DO UPDATE SET
                        failures = t.failures + 1,
                        locked_until = CASE
                            WHEN t.failures + 1 >= %(limit)s
                            THEN now() + make_interval(secs => %(lockout)s)
                            ELSE t.locked_until
                        END
                    """,
                    params,
                )
            await conn.execute(
                "DELETE FROM login_throttle WHERE window_started_at < now() - interval"
                " '1 day' AND (locked_until IS NULL OR locked_until < now())"
            )

    async def record_success(self, keys: list[str]) -> None:
        # Only the account key resets; the address key keeps counting.
        account_keys = [k for k in keys if not k.startswith("login-ip:")]
        async with self._pool.connection() as conn:
            await conn.execute(
                "DELETE FROM login_throttle WHERE key = ANY(%s)", (account_keys,)
            )


def get_throttle(pool: PoolDep) -> Throttle:
    """FastAPI dependency."""
    return PostgresThrottle(pool)


ThrottleDep = Annotated[Throttle, Depends(get_throttle)]
