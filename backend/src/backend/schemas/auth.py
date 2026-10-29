from pydantic import Field

from backend.schemas.base import CamelModel


class TokenRequest(CamelModel):
    email: str
    password: str


class TokenResponse(CamelModel):
    access_token: str
    refresh_token: str = Field(
        description="Single-use; exchange at `POST /auth/refresh` for a new pair"
    )
    token_type: str = Field(default="bearer")
    expires_in: int = Field(description="Lifetime of the token in seconds")


class PasswordChange(CamelModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class RefreshRequest(CamelModel):
    refresh_token: str = Field(max_length=256)
