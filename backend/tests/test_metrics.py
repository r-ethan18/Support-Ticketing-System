import socket
import urllib.request

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from tests.conftest import Seeder


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def scrape(port: int) -> str:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/metrics") as r:
        return r.read().decode()


def test_metrics_are_not_served_on_the_api_port(client: TestClient) -> None:
    assert client.get("/metrics").status_code == 404


def test_requests_are_counted_by_route_template(client: TestClient) -> None:
    client.get("/api/v1/auth/me")
    # The no-database app has no metrics listener; read the registry directly.
    from prometheus_client import generate_latest

    text = generate_latest().decode()
    assert 'handler="/api/v1/auth/me"' in text


def test_metrics_listener_exposes_http_and_pool_metrics(
    seed: Seeder, monkeypatch: pytest.MonkeyPatch
) -> None:
    port = free_port()
    monkeypatch.setenv("METRICS_PORT", str(port))
    from backend.config import get_settings

    get_settings.cache_clear()
    with TestClient(create_app()) as c:
        c.get("/api/v1/auth/me")
        body = scrape(port)
    assert "http_requests_total" in body
    assert "db_pool_size" in body
    assert "db_pool_available" in body
    with pytest.raises(OSError):
        scrape(port)  # listener is torn down with the app
