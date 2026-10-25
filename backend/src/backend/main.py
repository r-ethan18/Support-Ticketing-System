from importlib.metadata import PackageNotFoundError, version

from fastapi import FastAPI
from fastapi.routing import APIRoute

from backend.routers import api_router


def _operation_id(route: APIRoute) -> str:
    # Use the handler name (unique across routers) so generated frontend clients
    # get readable names like `listTickets` instead of FastAPI's long default.
    return route.name


def _version() -> str:
    try:
        return version("backend")
    except PackageNotFoundError:
        return "0.0.0"


def create_app() -> FastAPI:
    app = FastAPI(
        title="Support Ticketing System API",
        version=_version(),
        description=(
            "REST API for the support ticketing system. Authenticate via"
            " `POST /api/v1/auth/token` and send the token as a Bearer header."
        ),
        generate_unique_id_function=_operation_id,
    )
    # TODO(first-run): POST /admins needs an admin token, so the first admin cannot
    # be created through the API. On startup, if no admin exists, create one from
    # ADMIN_EMAIL / ADMIN_PASSWORD (and refuse to start if they are unset). At least
    # one admin account must exist after first run. Needs the Postgres layer.
    app.include_router(api_router)
    return app


app = create_app()
