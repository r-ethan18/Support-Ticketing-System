"""Prometheus metrics, served on their own port.

HTTP metrics are recorded in-process by middleware on the API app. They are
exposed by a separate listener (default `:9100`) rather than a `/metrics`
route, so the public ingress for the API port can never reach them; in
Kubernetes a NetworkPolicy then limits that port to Prometheus.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from http.server import HTTPServer
from threading import Thread

from fastapi import FastAPI
from prometheus_client import REGISTRY, start_http_server
from prometheus_client.core import GaugeMetricFamily
from prometheus_client.registry import Collector
from prometheus_fastapi_instrumentator import Instrumentator
from psycopg_pool import AsyncConnectionPool

from backend.config import get_settings


def instrument(app: FastAPI) -> None:
    """Record request count, latency and in-flight requests per route."""
    Instrumentator(should_group_status_codes=False).instrument(app)


class PoolCollector(Collector):
    """Report connection pool usage, read from the pool at scrape time."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    def collect(self) -> Iterator[GaugeMetricFamily]:
        stats = self._pool.get_stats()
        for key, doc in (
            ("pool_size", "Connections currently held by the pool"),
            ("pool_available", "Idle connections ready to be used"),
            ("requests_waiting", "Requests queued waiting for a connection"),
        ):
            gauge = GaugeMetricFamily(f"db_{key}", doc)
            gauge.add_metric([], stats[key])
            yield gauge


@contextmanager
def serve_metrics(pool: AsyncConnectionPool) -> Iterator[None]:
    """Expose metrics on `METRICS_PORT` for the life of the app (0 disables)."""
    port = get_settings().metrics_port
    if not port:
        yield
        return
    collector = PoolCollector(pool)
    REGISTRY.register(collector)
    server: HTTPServer
    thread: Thread
    server, thread = start_http_server(port)
    try:
        yield
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        REGISTRY.unregister(collector)
