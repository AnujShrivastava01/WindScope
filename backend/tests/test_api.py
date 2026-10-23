"""API integration tests against an in-memory store and mocked Elexon (synthetic)."""

from __future__ import annotations

import io

import httpx
import pandas as pd
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import elexon_handler, make_settings, mock_client_factory

WINDOW = {"start_date": "2026-01-02", "end_date": "2026-01-02"}


def test_health(api: TestClient):
    body = api.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["records"] == {"actual": 0, "forecast": 0}


def test_meta_exposes_assumptions(api: TestClient):
    body = api.get("/api/meta").json()
    assert body["default_cutoff_time"] == "10:00"
    assert body["default_window"]["start_date"] == "2026-01-02"
    assert body["default_window"]["end_date"] == "2026-02-01"
    assert any("not an official Elexon rule" in a for a in body["assumptions"])


def test_empty_store_returns_null_metrics(api: TestClient):
    body = api.get("/api/accuracy/summary", params=WINDOW).json()
    assert body["metrics"]["count"] == 0
    assert body["metrics"]["mae_mw"] is None
    assert body["coverage"]["matched"] == 0
    assert body["largest_errors"] == []


def test_refresh_then_overview(seeded_api: TestClient):
    body = seeded_api.get("/api/overview", params=WINDOW).json()
    kpis = body["kpis"]
    # 00:00 -> selected 09:30 vintage (1050) vs actual 1000; 01:00 -> 1300 vs 1200
    assert kpis["metrics"]["count"] == 2
    assert kpis["metrics"]["mae_mw"] == 75.0
    assert kpis["metrics"]["bias_mw"] == 75.0
    assert kpis["latest_forecast"]["forecast_mw"] == 1300.0
    coverage = kpis["coverage"]
    assert coverage["late_forecast_only"] == 1
    assert coverage["forecast_target_periods"] == 24
    assert coverage["actual_observed"] == 3


def test_refresh_is_idempotent(api: TestClient):
    first = api.post("/api/data/refresh").json()
    assert first["datasets"]["actual"]["inserted"] == 3
    assert first["datasets"]["forecast"]["inserted"] == 5


def test_never_shows_unobserved_actual(seeded_api: TestClient):
    items = seeded_api.get("/api/accuracy/timeseries", params=WINDOW).json()["items"]
    late = next(i for i in items if i["start_time"] == "2026-01-02T02:00:00Z")
    assert late["status"] == "late_forecast_only"
    assert late["actual_mw"] is None
    assert late["forecast_mw"] is None
    assert late["latest_available_mw"] == 1400.0


def test_forecast_vintages_endpoint(seeded_api: TestClient):
    body = seeded_api.get("/api/forecast-vintages", params={"target_time": "2026-01-02T00:00:00Z"}).json()
    assert body["cutoff_time"] == "2026-01-01T10:00:00Z"
    assert body["selected"]["generation_mw"] == 1050.0
    assert body["latest_available"]["generation_mw"] == 1001.0
    assert body["eligible_count"] == 2
    assert body["excluded_late_count"] == 1
    assert [v["eligible"] for v in body["vintages"]] == [True, True, False]
    assert "excluded" in body["explanation"]


def test_cutoff_parameter_changes_selection(seeded_api: TestClient):
    early = seeded_api.get(
        "/api/forecast-vintages", params={"target_time": "2026-01-02T00:00:00Z", "cutoff_time": "08:00"}
    ).json()
    assert early["selected"]["generation_mw"] == 900.0
    summary = seeded_api.get("/api/accuracy/summary", params={**WINDOW, "cutoff_time": "08:00"}).json()
    assert summary["metrics"]["count"] == 1  # 01:00 has no vintage before 08:00


def test_forecast_periods_paging_and_sorting(seeded_api: TestClient):
    body = seeded_api.get(
        "/api/forecast-periods", params={**WINDOW, "page_size": 5, "sort": "abs_error_mw", "order": "desc"}
    ).json()
    assert body["total"] == 48
    assert len(body["items"]) == 5
    assert body["items"][0]["abs_error_mw"] == 100.0
    filtered = seeded_api.get("/api/forecast-periods", params={**WINDOW, "status": "matched"}).json()
    assert filtered["total"] == 2


def test_distribution(seeded_api: TestClient):
    body = seeded_api.get("/api/accuracy/distribution", params=WINDOW).json()
    assert body["count"] == 2
    assert len(body["scatter"]) == 2
    assert sum(b["count"] for b in body["abs_error_histogram"]) == 2


def test_records_endpoints(seeded_api: TestClient):
    actuals = seeded_api.get(
        "/api/actuals", params={**WINDOW, "sort": "generation_mw", "order": "desc"}
    ).json()
    assert actuals["total"] == 3
    assert actuals["items"][0]["generation_mw"] == 1200.0
    assert actuals["expected_periods"] == 48
    assert actuals["missing_periods"] == 45
    forecasts = seeded_api.get(
        "/api/forecasts", params={**WINDOW, "publish_to": "2026-01-01T10:00:00Z", "page_size": 2}
    ).json()
    assert forecasts["total"] == 3
    assert len(forecasts["items"]) == 2


def test_csv_export_uses_filtered_rows(seeded_api: TestClient):
    response = seeded_api.get(
        "/api/export/csv", params={**WINDOW, "dataset": "analysis", "status": "matched"}
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    frame = pd.read_csv(io.BytesIO(response.content))
    assert len(frame) == 2
    assert set(frame["status"]) == {"matched"}
    assert frame.loc[0, "forecast_publish_time_utc"] == "2026-01-01T09:30:00Z"

    fx = pd.read_csv(
        io.BytesIO(seeded_api.get("/api/export/csv", params={**WINDOW, "dataset": "forecasts"}).content)
    )
    assert len(fx) == 5
    assert "publish_time_utc" in fx.columns


def test_parameter_validation(api: TestClient):
    bad = [
        ("/api/overview", {"start_date": "2026-01-10", "end_date": "2026-01-01"}),
        ("/api/overview", {"start_date": "2026-01-01", "end_date": "2026-06-01"}),
        ("/api/overview", {"cutoff_time": "25:00"}),
        ("/api/overview", {"cutoff_days_before": 9}),
        ("/api/overview", {"start_date": "not-a-date"}),
        ("/api/forecast-vintages", {"target_time": "garbage"}),
        ("/api/forecast-vintages", {"target_time": "2026-01-02T00:10:00Z"}),
        ("/api/forecast-periods", {"status": "nonsense"}),
        ("/api/actuals", {"page_size": 10_000}),
    ]
    for path, params in bad:
        response = api.get(path, params=params)
        assert response.status_code == 422, (path, params, response.text)
        assert response.json()["error"]["code"] == "validation_error"


def test_unknown_route_has_consistent_error(api: TestClient):
    response = api.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_refresh_failure_is_not_reported_as_success():
    app = create_app(make_settings(), client_factory=mock_client_factory(elexon_handler(status=503)))
    with TestClient(app) as client:
        body = client.post("/api/data/refresh").json()
        assert body["status"] == "failed"
        assert body["datasets"]["actual"]["status"] == "failed"
        assert body["datasets"]["actual"]["retries"] > 0
        health = client.get("/api/data-health").json()
        assert health["datasets"]["actual"]["status"] == "empty"
        assert health["datasets"]["actual"]["last_successful_fetch"] is None
        assert health["refresh_history"][0]["status"] == "failed"


def test_refresh_partial_when_one_dataset_fails():
    def handler(request: httpx.Request) -> httpx.Response:
        if "WINDFOR" in request.url.path:
            return httpx.Response(500)
        return elexon_handler()(request)

    app = create_app(make_settings(), client_factory=mock_client_factory(handler))
    with TestClient(app) as client:
        body = client.post("/api/data/refresh").json()
        assert body["status"] == "partial"
        assert body["datasets"]["actual"]["status"] == "success"
        assert body["datasets"]["forecast"]["status"] == "failed"


def test_csv_import_flow(api: TestClient):
    csv = (
        "startTime,publishTime,generation\n"
        "2026-01-02T00:00:00Z,2026-01-01T09:30:00Z,1000\n"
        "2026-01-02T00:00:00Z,not-a-time,1000\n"
    )
    response = api.post(
        "/api/data/import",
        data={"dataset": "forecast"},
        files={"file": ("forecast.csv", csv, "text/csv")},
    )
    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "partial"
    assert body["accepted"] == 1
    assert body["inserted"] == 1
    assert body["rejected_rows"][0]["row"] == 3

    bad = api.post(
        "/api/data/import",
        data={"dataset": "actual"},
        files={"file": ("a.csv", "foo,bar\n1,2\n", "text/csv")},
    )
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "invalid_csv"


def test_csv_import_does_not_overwrite_api_data(seeded_api: TestClient):
    csv = "startTime,fuelType,generation\n2026-01-02T00:00:00Z,WIND,1\n"
    body = seeded_api.post(
        "/api/data/import", data={"dataset": "actual"}, files={"file": ("a.csv", csv, "text/csv")}
    ).json()
    assert body["skipped_existing_api"] == 1
    actual = seeded_api.get("/api/actuals", params=WINDOW).json()["items"][0]
    assert actual["generation_mw"] == 1000.0


def test_data_health(seeded_api: TestClient):
    body = seeded_api.get("/api/data-health").json()
    actual = body["datasets"]["actual"]
    assert actual["records"] == 3
    assert actual["status"] == "incomplete"
    assert actual["last_successful_fetch"] is not None
    assert body["coverage"]["total_periods"] == 31 * 48
    assert body["missing_periods_total"] > 0
    assert body["cache"]["data_version"] >= 1
