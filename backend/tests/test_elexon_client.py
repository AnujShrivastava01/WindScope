"""Elexon HTTP client behaviour using a mocked transport (no network)."""

from __future__ import annotations

from datetime import UTC, date, datetime

import httpx
import pytest

from app.services.elexon_client import ElexonClient, ElexonError, extract_records


def make_client(handler, *, max_retries: int = 2, chunk_days: int = 7, sleeps: list | None = None):
    recorded = sleeps if sleeps is not None else []
    return ElexonClient(
        "https://example.test/api",
        transport=httpx.MockTransport(handler),
        max_retries=max_retries,
        backoff_seconds=0.5,
        chunk_days=chunk_days,
        sleep=recorded.append,
    )


def test_fuelhh_request_parameters():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(dict(request.url.params))
        assert request.url.path == "/api/datasets/FUELHH/stream"
        return httpx.Response(200, json=[{"fuelType": "WIND"}])

    with make_client(handler, chunk_days=7) as client:
        result = client.fetch_fuelhh(date(2026, 1, 1), date(2026, 1, 10))
    assert seen == [
        {"settlementDateFrom": "2026-01-01", "settlementDateTo": "2026-01-07", "fuelType": "WIND"},
        {"settlementDateFrom": "2026-01-08", "settlementDateTo": "2026-01-10", "fuelType": "WIND"},
    ]
    assert len(result.records) == 2
    assert result.requests == 2
    assert result.complete


def test_windfor_chunks_publish_window():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.params["publishDateTimeFrom"])
        return httpx.Response(200, json=[])

    with make_client(handler, chunk_days=7) as client:
        client.fetch_windfor(datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 20, tzinfo=UTC))
    assert seen == ["2026-01-01T00:00:00Z", "2026-01-08T00:00:00Z", "2026-01-15T00:00:00Z"]


def test_transient_errors_are_retried_with_backoff():
    calls = {"n": 0}
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503)
        return httpx.Response(200, json=[{"a": 1}])

    with make_client(handler, sleeps=sleeps) as client:
        result = client.fetch_fuelhh(date(2026, 1, 1), date(2026, 1, 1))
    assert result.retries == 2
    assert result.records == [{"a": 1}]
    assert sleeps == [0.5, 1.0]


def test_rate_limit_honours_retry_after():
    calls = {"n": 0}
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "3"})
        return httpx.Response(200, json=[])

    with make_client(handler, sleeps=sleeps) as client:
        client.fetch_fuelhh(date(2026, 1, 1), date(2026, 1, 1))
    assert sleeps == [3.0]


def test_retries_are_bounded_and_failure_is_reported():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    with make_client(handler, max_retries=2) as client:
        result = client.fetch_fuelhh(date(2026, 1, 1), date(2026, 1, 1))
    assert not result.complete
    assert result.records == []
    assert result.retries == 2
    assert "HTTP 500" in result.errors[0]


def test_non_retryable_status_fails_immediately():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400)

    with make_client(handler) as client:
        result = client.fetch_fuelhh(date(2026, 1, 1), date(2026, 1, 1))
    assert calls["n"] == 1
    assert not result.complete


def test_timeouts_are_retried_then_reported():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with make_client(handler, max_retries=1) as client:
        result = client.fetch_fuelhh(date(2026, 1, 1), date(2026, 1, 1))
    assert "timed out" in result.errors[0]
    assert result.retries == 1


def test_malformed_json_is_reported():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>oops</html>")

    with make_client(handler) as client:
        result = client.fetch_fuelhh(date(2026, 1, 1), date(2026, 1, 1))
    assert "malformed" in result.errors[0]


def test_partial_chunk_failure_keeps_successful_records():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params["settlementDateFrom"] == "2026-01-08":
            return httpx.Response(502)
        return httpx.Response(200, json=[{"ok": True}])

    with make_client(handler, max_retries=0) as client:
        result = client.fetch_fuelhh(date(2026, 1, 1), date(2026, 1, 14))
    assert len(result.records) == 1
    assert len(result.failed_chunks) == 1


def test_extract_records_supports_both_payload_shapes():
    assert extract_records([{"a": 1}, "junk"]) == [{"a": 1}]
    assert extract_records({"data": [{"a": 2}]}) == [{"a": 2}]
    with pytest.raises(ElexonError):
        extract_records({"unexpected": True})
