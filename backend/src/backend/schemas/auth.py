from pydantic import Field

from backend.schemas.base import CamelModel


class TokenRequest(CamelModel):
    # PLACEHOLDER: the ER has no credential storage, so how people log in
    # (password, SSO, magic link, ...) is still undecided.
    email: str
    password: str


class TokenResponse(CamelModel):
    access_token: str
    token_type: str = Field(default="bearer")
    expires_in: int = Field(description="Lifetime of the token in seconds")
