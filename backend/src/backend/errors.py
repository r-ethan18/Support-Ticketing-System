from typing import Any, NoReturn

from fastapi import HTTPException, status
from pydantic import BaseModel


class ErrorResponse(BaseModel):
    """Body returned by every non-2xx response (FastAPI's default shape)."""

    detail: str


UNAUTHORIZED: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Missing or invalid access token"},
}
FORBIDDEN: dict[int | str, dict[str, Any]] = {
    403: {"model": ErrorResponse, "description": "Caller's role may not do this"},
}
NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Resource not found"},
}


def not_implemented() -> NoReturn:
    """Placeholder body for every endpoint while the contract is being settled."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented"
    )
