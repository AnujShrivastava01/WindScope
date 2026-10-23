"""HTTP client for the Elexon Insights Solution (BMRS) public API.

Endpoints used (both public, no API key required):

* ``GET /datasets/FUELHH/stream`` filtered by ``settlementDateFrom``/``settlementDateTo``
  and ``fuelType=WIND``.
* ``GET /datasets/WINDFOR/stream`` filtered by ``publishDateTimeFrom``/``publishDateTimeTo``.

The ``/stream`` endpoints return a plain JSON array without pagination, so large
ranges are split into bounded chunks to keep responses small and to limit the
blast radius of a failed request. Transient failures (timeouts, connection
errors, HTTP 429 and 5xx) are retried with bounded exponential backoff.
"""

from __future__ import annotations

import logging
import time as time_module
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

import httpx

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}
MAX_RETRY_AFTER_SECONDS = 30.0


class ElexonError(Exception):
    """Raised when the Elexon API cannot return a usable response."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(slots=True)
class FetchResult:
    records: list[dict[str, object]] = field(default_factory=list)
    requests: int = 0
    retries: int = 0
    failed_chunks: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return not self.failed_chunks


class ElexonClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 30.0,
        max_retries: int = 3,
        backoff_seconds: float = 1.0,
        chunk_days: int = 7,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time_module.sleep,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout),
            headers={"Accept": "application/json", "User-Agent": "WindScope/1.0"},
            transport=transport,
        )
        self.max_retries = max(0, max_retries)
        self.backoff_seconds = backoff_seconds
        self.chunk_days = max(1, chunk_days)
        self._sleep = sleep

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> ElexonClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ------------------------------------------------------------------ datasets
    def fetch_fuelhh(self, settlement_from: date, settlement_to: date) -> FetchResult:
        """Fetch FUELHH WIND rows for inclusive UK settlement dates."""
        result = FetchResult()
        for chunk_start, chunk_end in _date_chunks(settlement_from, settlement_to, self.chunk_days):
            params = {
                "settlementDateFrom": chunk_start.isoformat(),
                "settlementDateTo": chunk_end.isoformat(),
                "fuelType": "WIND",
            }
            self._fetch_chunk("/datasets/FUELHH/stream", params, result)
        return result

    def fetch_windfor(self, publish_from: datetime, publish_to: datetime) -> FetchResult:
        """Fetch WINDFOR rows whose publishTime falls inside [publish_from, publish_to]."""
        result = FetchResult()
        for chunk_start, chunk_end in _datetime_chunks(publish_from, publish_to, self.chunk_days):
            params = {
                "publishDateTimeFrom": _iso(chunk_start),
                "publishDateTimeTo": _iso(chunk_end),
            }
            self._fetch_chunk("/datasets/WINDFOR/stream", params, result)
        return result

    # ------------------------------------------------------------------ internals
    def _fetch_chunk(self, path: str, params: dict[str, str], result: FetchResult) -> None:
        label = f"{path}?{'&'.join(f'{k}={v}' for k, v in params.items())}"
        try:
            payload, retries, requests = self._get_json(path, params)
        except ElexonError as exc:
            logger.warning("elexon chunk failed", extra={"chunk": label, "error": str(exc)})
            result.failed_chunks.append(label)
            result.errors.append(str(exc))
            result.retries += getattr(exc, "retries", 0)
            result.requests += getattr(exc, "requests", 1)
            return
        result.retries += retries
        result.requests += requests
        result.records.extend(extract_records(payload))

    def _get_json(self, path: str, params: dict[str, str]) -> tuple[object, int, int]:
        attempt = 0
        while True:
            attempt += 1
            retry_after: float | None = None
            try:
                response = self._client.get(path, params=params)
            except httpx.TimeoutException:
                failure = "Elexon API request timed out"
            except httpx.TransportError as exc:
                failure = f"Elexon API connection error ({type(exc).__name__})"
            else:
                if response.status_code == 200:
                    try:
                        return response.json(), attempt - 1, attempt
                    except ValueError as exc:
                        raise self._error("Elexon API returned malformed JSON", attempt) from exc
                if response.status_code not in RETRYABLE_STATUS:
                    raise self._error(
                        f"Elexon API returned HTTP {response.status_code}",
                        attempt,
                        status_code=response.status_code,
                    )
                failure = f"Elexon API returned HTTP {response.status_code}"
                retry_after = _retry_after_seconds(response)

            if attempt > self.max_retries:
                raise self._error(f"{failure} after {attempt} attempts", attempt)
            delay = retry_after if retry_after is not None else self.backoff_seconds * 2 ** (attempt - 1)
            logger.info("retrying elexon request", extra={"path": path, "attempt": attempt, "delay": delay})
            self._sleep(min(delay, MAX_RETRY_AFTER_SECONDS))

    @staticmethod
    def _error(message: str, attempt: int, status_code: int | None = None) -> ElexonError:
        error = ElexonError(message, status_code=status_code)
        error.retries = attempt - 1  # type: ignore[attr-defined]
        error.requests = attempt  # type: ignore[attr-defined]
        return error


def extract_records(payload: object) -> list[dict[str, object]]:
    """Return the list of records from a stream (array) or standard (``data``) payload."""
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict) and isinstance(payload.get("data"), list):
        rows = payload["data"]
    else:
        raise ElexonError("Elexon API response did not contain a list of records")
    return [row for row in rows if isinstance(row, dict)]


def _retry_after_seconds(response: httpx.Response) -> float | None:
    header = response.headers.get("Retry-After")
    if not header:
        return None
    try:
        return max(0.0, float(header))
    except ValueError:
        return None


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _date_chunks(start: date, end: date, days: int) -> Iterator[tuple[date, date]]:
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=days - 1), end)
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def _datetime_chunks(start: datetime, end: datetime, days: int) -> Iterator[tuple[datetime, datetime]]:
    # Consecutive chunks share a boundary instant; duplicates are removed during parsing.
    cursor = start
    step = timedelta(days=days)
    while cursor < end:
        chunk_end = min(cursor + step, end)
        yield cursor, chunk_end
        cursor = chunk_end
