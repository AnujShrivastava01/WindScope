"""Shared test fixtures.

All data in this test-suite is SYNTHETIC and exists only to exercise the logic;
it is never used by the running application.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.elexon_client import ElexonClient


def make_settings(**overrides) -> Settings:
    base = {
        "database_path": ":memory:",
        "auto_ingest_on_startup": False,
        "elexon_backoff_seconds": 0.0,
        "log_level": "WARNING",
    }
    base.update(overrides)
    return Settings(**base)


def mock_client_factory(handler: Callable[[httpx.Request], httpx.Response]) -> Callable[[], ElexonClient]:
    def factory() -> ElexonClient:
        return ElexonClient(
            "https://example.test/bmrs/api/v1",
            transport=httpx.MockTransport(handler),
            max_retries=2,
            backoff_seconds=0,
            sleep=lambda _: None,
        )

    return factory


# Synthetic payloads -----------------------------------------------------------
SYNTHETIC_ACTUALS = [
    # delivery day 2026-01-02, hourly and half-hourly periods
    {"fuelType": "WIND", "startTime": "2026-01-02T00:00:00Z", "generation": 1000,
     "settlementDate": "2026-01-02", "settlementPeriod": 1, "publishTime": "2026-01-02T00:30:00Z"},
    {"fuelType": "WIND", "startTime": "2026-01-02T00:30:00Z", "generation": 1100,
     "settlementDate": "2026-01-02", "settlementPeriod": 2, "publishTime": "2026-01-02T01:00:00Z"},
    {"fuelType": "WIND", "startTime": "2026-01-02T01:00:00Z", "generation": 1200,
     "settlementDate": "2026-01-02", "settlementPeriod": 3, "publishTime": "2026-01-02T01:30:00Z"},
    {"fuelType": "CCGT", "startTime": "2026-01-02T01:00:00Z", "generation": 9999,
     "settlementDate": "2026-01-02", "settlementPeriod": 3, "publishTime": "2026-01-02T01:30:00Z"},
]  # fmt: skip

SYNTHETIC_FORECASTS = [
    # Two vintages before the 10:00 D-1 cutoff and one after for 00:00.
    {"startTime": "2026-01-02T00:00:00Z", "publishTime": "2026-01-01T07:30:00Z", "generation": 900},
    {"startTime": "2026-01-02T00:00:00Z", "publishTime": "2026-01-01T09:30:00Z", "generation": 1050},
    {"startTime": "2026-01-02T00:00:00Z", "publishTime": "2026-01-01T15:30:00Z", "generation": 1001},
    {"startTime": "2026-01-02T01:00:00Z", "publishTime": "2026-01-01T09:30:00Z", "generation": 1300},
    # Only published after the cutoff -> late_forecast_only
    {"startTime": "2026-01-02T02:00:00Z", "publishTime": "2026-01-01T18:30:00Z", "generation": 1400},
]


def elexon_handler(
    actuals=None, forecasts=None, *, status: int = 200
) -> Callable[[httpx.Request], httpx.Response]:
    actuals = SYNTHETIC_ACTUALS if actuals is None else actuals
    forecasts = SYNTHETIC_FORECASTS if forecasts is None else forecasts
    served: dict[str, bool] = {"actual": False, "forecast": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if status != 200:
            return httpx.Response(status)
        if "FUELHH" in request.url.path:
            # Serve data only once so chunked requests do not multiply rows.
            body = [] if served["actual"] else actuals
            served["actual"] = True
            return httpx.Response(200, json=body)
        body = [] if served["forecast"] else forecasts
        served["forecast"] = True
        return httpx.Response(200, json=body)

    return handler


@pytest.fixture
def client_factory() -> Callable[[], ElexonClient]:
    return mock_client_factory(elexon_handler())


@pytest.fixture
def api(client_factory) -> Iterator[TestClient]:
    app = create_app(make_settings(), client_factory=client_factory)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def seeded_api(api: TestClient) -> TestClient:
    response = api.post("/api/data/refresh")
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    return api
