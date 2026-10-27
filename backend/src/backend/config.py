import os
from dataclasses import dataclass
from functools import lru_cache

from psycopg.conninfo import make_conninfo

MIN_SECRET_LENGTH = 32


@dataclass(frozen=True)
class DatabaseSettings:
    host: str = "localhost"
    port: int = 5432
    name: str = "sts"
    user: str = "sts"
    password: str = ""

    @property
    def conninfo(self) -> str:
        return make_conninfo(
            host=self.host,
            port=self.port,
            dbname=self.name,
            user=self.user,
            password=self.password,
        )


@dataclass(frozen=True)
class Settings:
    jwt_secret: str
    access_token_ttl_seconds: int = 3600
    database: DatabaseSettings = DatabaseSettings()


@lru_cache
def get_settings() -> Settings:
    """Read settings from the environment on first use.

    Deliberately lazy: importing the app (e.g. to dump the OpenAPI spec in the
    pre-commit hook) must not require secrets.
    """
    secret = os.environ.get("JWT_SECRET", "")
    if len(secret) < MIN_SECRET_LENGTH:
        raise RuntimeError(
            f"JWT_SECRET must be set to at least {MIN_SECRET_LENGTH} characters"
        )
    return Settings(
        jwt_secret=secret,
        access_token_ttl_seconds=int(
            os.environ.get("ACCESS_TOKEN_TTL_SECONDS", "3600")
        ),
        database=DatabaseSettings(
            host=os.environ.get("DB_HOST", "localhost"),
            port=int(os.environ.get("DB_PORT", "5432")),
            name=os.environ.get("DB_NAME", "sts"),
            user=os.environ.get("DB_USER", "sts"),
            password=os.environ.get("DB_PASSWORD", ""),
        ),
    )
