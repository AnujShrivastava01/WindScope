"""Refresh orchestration: fetch -> parse/validate -> idempotent upsert -> audit log."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import asdict
from datetime import UTC, date, datetime, time, timedelta

from app.core.config import Settings
from app.repositories.records import RecordsRepository, UpsertResult
from app.services.actual_generation import parse_fuelhh_records
from app.services.csv_io import parse_csv_upload
from app.services.elexon_client import ElexonClient, ElexonError, FetchResult
from app.services.models import ParseResult
from app.services.wind_forecasts import parse_windfor_records
from app.utils.time import UK_TZ, to_iso_z

logger = logging.getLogger(__name__)

MAX_DAYS_BEFORE = 2


def ingestion_window(settings: Settings) -> dict[str, object]:
    """Date windows fetched from Elexon for the configured decision period.

    Decision dates D cover delivery days D+1..D+MAX_DAYS_BEFORE. WINDFOR vintages
    are fetched from two days before the first decision date (forecast horizon is
    roughly two days) until the end of the last delivery day, so later vintages
    that must be *excluded* are also visible for transparency.
    """
    first_delivery = settings.decision_date_start + timedelta(days=1)
    last_delivery = settings.decision_date_end + timedelta(days=MAX_DAYS_BEFORE)
    publish_from = datetime.combine(settings.decision_date_start - timedelta(days=2), time(0), tzinfo=UK_TZ)
    publish_to = datetime.combine(last_delivery + timedelta(days=1), time(0), tzinfo=UK_TZ)
    return {
        "actual_settlement_from": first_delivery,
        "actual_settlement_to": last_delivery,
        "forecast_publish_from": publish_from.astimezone(UTC),
        "forecast_publish_to": publish_to.astimezone(UTC),
    }


class IngestionService:
    def __init__(
        self,
        repo: RecordsRepository,
        settings: Settings,
        client_factory: Callable[[], ElexonClient] | None = None,
    ) -> None:
        self.repo = repo
        self.settings = settings
        self._client_factory = client_factory or self._default_client
        self._lock = threading.Lock()
        self._last_result: dict[str, object] | None = None
        self.in_progress = False

    def _default_client(self) -> ElexonClient:
        s = self.settings
        return ElexonClient(
            s.elexon_base_url,
            timeout=s.elexon_timeout_seconds,
            max_retries=s.elexon_max_retries,
            backoff_seconds=s.elexon_backoff_seconds,
            chunk_days=s.elexon_chunk_days,
        )

    @property
    def last_result(self) -> dict[str, object] | None:
        return self._last_result

    def refresh(self, trigger: str = "manual") -> dict[str, object]:
        """Run a refresh; concurrent callers wait for and share the in-flight run."""
        if not self._lock.acquire(blocking=False):
            with self._lock:
                pass
            shared = dict(self._last_result or {})
            shared["deduplicated"] = True
            return shared
        try:
            self.in_progress = True
            result = self._refresh(trigger)
            self._last_result = result
            return result
        finally:
            self.in_progress = False
            self._lock.release()

    def _refresh(self, trigger: str) -> dict[str, object]:
        window = ingestion_window(self.settings)
        started = datetime.now(UTC)
        datasets: dict[str, dict[str, object]] = {}
        try:
            client = self._client_factory()
        except Exception:  # pragma: no cover - defensive, construction should not fail
            logger.exception("could not create Elexon client")
            client = None
        if client is None:
            for name in ("actual", "forecast"):
                datasets[name] = self._log_failure(name, trigger, started, "Elexon client unavailable")
        else:
            with client:
                datasets["actual"] = self._run_dataset(
                    "actual",
                    trigger,
                    lambda: client.fetch_fuelhh(
                        window["actual_settlement_from"], window["actual_settlement_to"]
                    ),
                    parse_fuelhh_records,
                    self.repo.upsert_actuals,
                )
                datasets["forecast"] = self._run_dataset(
                    "forecast",
                    trigger,
                    lambda: client.fetch_windfor(
                        window["forecast_publish_from"], window["forecast_publish_to"]
                    ),
                    parse_windfor_records,
                    self.repo.upsert_forecasts,
                )
        statuses = {d["status"] for d in datasets.values()}
        if statuses == {"success"}:
            overall = "success"
        elif statuses == {"failed"}:
            overall = "failed"
        else:
            overall = "partial"
        result = {
            "status": overall,
            "trigger": trigger,
            "started_at": to_iso_z(started),
            "finished_at": to_iso_z(datetime.now(UTC)),
            "datasets": datasets,
            "window": {k: v.isoformat() if isinstance(v, date) else v for k, v in window.items()},
            "deduplicated": False,
        }
        logger.info("refresh finished", extra={"status": overall, "trigger": trigger})
        return result

    def _run_dataset(
        self,
        name: str,
        trigger: str,
        fetch: Callable[[], FetchResult],
        parse: Callable[..., ParseResult],
        upsert: Callable[[list], UpsertResult],
    ) -> dict[str, object]:
        started = datetime.now(UTC)
        try:
            fetched = fetch()
        except ElexonError as exc:
            return self._log_failure(name, trigger, started, str(exc))
        except Exception:
            logger.exception("unexpected error fetching %s", name)
            return self._log_failure(name, trigger, started, "Unexpected error while fetching data")

        parsed = parse(fetched.records)
        upserted = upsert(parsed.records)
        notes: list[str] = []
        if fetched.failed_chunks:
            notes.append(
                f"{len(fetched.failed_chunks)} request chunk(s) failed: {'; '.join(fetched.errors[:3])}"
            )
        if fetched.complete and not fetched.records:
            notes.append("The API returned no records for the requested window.")
        if not fetched.records and fetched.failed_chunks:
            status = "failed"
        elif fetched.failed_chunks or not fetched.records:
            status = "partial"
        else:
            status = "success"
        entry = {
            "dataset": name,
            "trigger": trigger,
            "status": status,
            "started_at": to_iso_z(started),
            "finished_at": to_iso_z(datetime.now(UTC)),
            "requests": fetched.requests,
            "retries": fetched.retries,
            "received": parsed.received,
            "inserted": upserted.inserted,
            "updated": upserted.updated,
            "unchanged": upserted.unchanged,
            "rejected": parsed.rejected_count,
            "duplicates": parsed.duplicates,
            "duplicate_conflicts": parsed.duplicate_conflicts,
            "missing_publish_time": parsed.missing_publish_time,
            "error": " | ".join(notes) or None,
        }
        self.repo.log_refresh(entry)
        entry["filtered_out"] = parsed.filtered_out
        entry["rejected_examples"] = [{"row": r.row, "reason": r.reason} for r in parsed.rejected[:5]]
        return entry

    def _log_failure(self, name: str, trigger: str, started: datetime, error: str) -> dict[str, object]:
        entry = {
            "dataset": name,
            "trigger": trigger,
            "status": "failed",
            "started_at": to_iso_z(started),
            "finished_at": to_iso_z(datetime.now(UTC)),
            "requests": 0,
            "retries": 0,
            "received": 0,
            "inserted": 0,
            "updated": 0,
            "unchanged": 0,
            "rejected": 0,
            "duplicates": 0,
            "duplicate_conflicts": 0,
            "missing_publish_time": 0,
            "error": error,
        }
        self.repo.log_refresh(entry)
        return entry

    # ------------------------------------------------------------------ CSV import
    def import_csv(self, content: bytes, dataset: str, filename: str | None = None) -> dict[str, object]:
        """Validate and import a CSV of FUELHH (``actual``) or WINDFOR (``forecast``) rows."""
        outcome = parse_csv_upload(content, dataset)
        parsed = outcome.result
        upsert = self.repo.upsert_actuals if dataset == "actual" else self.repo.upsert_forecasts
        upserted = upsert(parsed.records)
        now = to_iso_z(datetime.now(UTC))
        accepted = len(parsed.records)
        status = "success" if accepted and not parsed.rejected else ("partial" if accepted else "failed")
        self.repo.log_refresh(
            {
                "dataset": dataset,
                "trigger": "csv_import",
                "status": status,
                "started_at": now,
                "finished_at": now,
                "requests": 0,
                "retries": 0,
                "received": parsed.received,
                "inserted": upserted.inserted,
                "updated": upserted.updated,
                "unchanged": upserted.unchanged,
                "rejected": parsed.rejected_count,
                "duplicates": parsed.duplicates,
                "duplicate_conflicts": parsed.duplicate_conflicts,
                "missing_publish_time": parsed.missing_publish_time,
                "error": f"file={filename}" if filename else None,
            }
        )
        return {
            "status": status,
            "dataset": dataset,
            "filename": filename,
            "columns": outcome.columns,
            "received": parsed.received,
            "accepted": accepted,
            "filtered_out_non_wind": parsed.filtered_out,
            "duplicates": parsed.duplicates,
            "duplicate_conflicts": parsed.duplicate_conflicts,
            **asdict(upserted),
            "rejected": parsed.rejected_count,
            "rejected_rows": [{"row": r.row, "reason": r.reason} for r in parsed.rejected[:200]],
        }
