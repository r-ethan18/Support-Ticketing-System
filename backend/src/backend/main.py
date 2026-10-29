from importlib.metadata import PackageNotFoundError, version

from fastapi import FastAPI
from fastapi.routing import APIRoute

from backend.db import lifespan
from backend.metrics import instrument
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


def create_app(*, with_database: bool = True) -> FastAPI:
    app = FastAPI(
        title="Support Ticketing System API",
        version=_version(),
        description=(
            "REST API for the support ticketing system. Authenticate via"
            " `POST /api/v1/auth/token` and send the token as a Bearer header."
        ),
        generate_unique_id_function=_operation_id,
        lifespan=lifespan if with_database else None,
    )
    app.include_router(api_router)
    instrument(app)
    return app


app = create_app()
