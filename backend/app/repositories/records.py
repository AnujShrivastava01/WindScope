"""Repository for actual generation, forecast vintages and refresh metadata."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

import pandas as pd

from app.repositories.database import Database
from app.services.models import ActualRecord, DataSource, ForecastRecord
from app.utils.time import to_iso_z


@dataclass(slots=True)
class UpsertResult:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    skipped_existing_api: int = 0


@dataclass(slots=True)
class Page:
    items: list[dict[str, object]]
    total: int


ACTUAL_SORT_COLUMNS = {"start_time", "generation_mw", "settlement_date", "source", "publish_time"}
FORECAST_SORT_COLUMNS = {"start_time", "publish_time", "generation_mw", "source"}


def _now() -> str:
    return to_iso_z(datetime.now(UTC))


class RecordsRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    # ------------------------------------------------------------------ versioning
    def data_version(self) -> int:
        with self.db.connection() as conn:
            row = conn.execute("SELECT value FROM app_meta WHERE key='data_version'").fetchone()
        return int(row["value"]) if row else 0

    def _bump_version(self, conn) -> None:
        conn.execute(
            "INSERT INTO app_meta (key, value) VALUES ('data_version', '1') "
            "ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"
        )

    # ------------------------------------------------------------------ writes
    def upsert_actuals(self, records: Sequence[ActualRecord]) -> UpsertResult:
        """Insert or update actuals keyed by ``start_time`` (idempotent).

        Elexon API data is authoritative: a CSV import never overwrites a value that
        was ingested from the API, while an API refresh replaces imported values.
        """
        result = UpsertResult()
        if not records:
            return result
        now = _now()
        with self.db.write_lock, self.db.connection() as conn:
            existing = {
                row["start_time"]: (row["generation_mw"], row["source"])
                for row in conn.execute("SELECT start_time, generation_mw, source FROM actual_generation")
            }
            for rec in records:
                key = to_iso_z(rec.start_time)
                current = existing.get(key)
                if current is not None:
                    value, source = current
                    if rec.source == DataSource.CSV_IMPORT and source == DataSource.ELEXON_API:
                        result.skipped_existing_api += 1
                        continue
                    if value == rec.generation_mw and source == rec.source:
                        result.unchanged += 1
                        continue
                    result.updated += 1
                else:
                    result.inserted += 1
                conn.execute(
                    "INSERT INTO actual_generation (start_time, settlement_date, settlement_period,"
                    " generation_mw, publish_time, source, ingested_at) VALUES (?,?,?,?,?,?,?)"
                    " ON CONFLICT(start_time) DO UPDATE SET settlement_date=excluded.settlement_date,"
                    " settlement_period=excluded.settlement_period, generation_mw=excluded.generation_mw,"
                    " publish_time=excluded.publish_time, source=excluded.source,"
                    " ingested_at=excluded.ingested_at",
                    (
                        key,
                        rec.settlement_date,
                        rec.settlement_period,
                        rec.generation_mw,
                        to_iso_z(rec.publish_time) if rec.publish_time else None,
                        str(rec.source),
                        now,
                    ),
                )
            if result.inserted or result.updated:
                self._bump_version(conn)
        return result

    def upsert_forecasts(self, records: Sequence[ForecastRecord]) -> UpsertResult:
        """Insert or update forecast vintages keyed by ``(start_time, publish_time)``."""
        result = UpsertResult()
        if not records:
            return result
        now = _now()
        with self.db.write_lock, self.db.connection() as conn:
            existing = {
                (row["start_time"], row["publish_time"]): (row["generation_mw"], row["source"])
                for row in conn.execute(
                    "SELECT start_time, publish_time, generation_mw, source FROM wind_forecast"
                )
            }
            rows = []
            for rec in records:
                key = (to_iso_z(rec.start_time), to_iso_z(rec.publish_time))
                current = existing.get(key)
                if current is not None:
                    value, source = current
                    if rec.source == DataSource.CSV_IMPORT and source == DataSource.ELEXON_API:
                        result.skipped_existing_api += 1
                        continue
                    if value == rec.generation_mw and source == rec.source:
                        result.unchanged += 1
                        continue
                    result.updated += 1
                else:
                    result.inserted += 1
                rows.append((*key, rec.generation_mw, str(rec.source), now))
            conn.executemany(
                "INSERT INTO wind_forecast (start_time, publish_time, generation_mw, source, ingested_at)"
                " VALUES (?,?,?,?,?) ON CONFLICT(start_time, publish_time) DO UPDATE SET"
                " generation_mw=excluded.generation_mw, source=excluded.source,"
                " ingested_at=excluded.ingested_at",
                rows,
            )
            if result.inserted or result.updated:
                self._bump_version(conn)
        return result

    def log_refresh(self, entry: dict[str, object]) -> None:
        columns = [
            "dataset", "trigger", "status", "started_at", "finished_at", "requests", "retries",
            "received", "inserted", "updated", "unchanged", "rejected", "duplicates",
            "duplicate_conflicts", "missing_publish_time", "error",
        ]  # fmt: skip
        values = [entry.get(col) for col in columns]
        with self.db.write_lock, self.db.connection() as conn:
            conn.execute(
                f"INSERT INTO refresh_log ({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))})",
                values,
            )

    # ------------------------------------------------------------------ analysis reads
    def actuals_frame(self, start: datetime, end: datetime) -> pd.DataFrame:
        """Actual rows with ``start <= start_time < end`` as a DataFrame."""
        with self.db.connection() as conn:
            rows = conn.execute(
                "SELECT start_time, generation_mw, source FROM actual_generation"
                " WHERE start_time >= ? AND start_time < ? ORDER BY start_time",
                (to_iso_z(start), to_iso_z(end)),
            ).fetchall()
        frame = pd.DataFrame([dict(r) for r in rows], columns=["start_time", "generation_mw", "source"])
        frame["start_time"] = pd.to_datetime(frame["start_time"], utc=True, format="ISO8601")
        frame["generation_mw"] = frame["generation_mw"].astype("float64")
        return frame

    def forecasts_frame(self, start: datetime, end: datetime) -> pd.DataFrame:
        """All forecast vintages whose target ``start_time`` is in [start, end)."""
        with self.db.connection() as conn:
            rows = conn.execute(
                "SELECT start_time, publish_time, generation_mw, source, ingested_at FROM wind_forecast"
                " WHERE start_time >= ? AND start_time < ? ORDER BY start_time, publish_time",
                (to_iso_z(start), to_iso_z(end)),
            ).fetchall()
        columns = ["start_time", "publish_time", "generation_mw", "source", "ingested_at"]
        frame = pd.DataFrame([dict(r) for r in rows], columns=columns)
        for col in ("start_time", "publish_time", "ingested_at"):
            frame[col] = pd.to_datetime(frame[col], utc=True, format="ISO8601")
        frame["generation_mw"] = frame["generation_mw"].astype("float64")
        return frame

    # ------------------------------------------------------------------ table reads
    def page_actuals(
        self,
        start: datetime,
        end: datetime,
        *,
        page: int,
        page_size: int,
        sort: str,
        descending: bool,
        source: str | None = None,
        search: str | None = None,
    ) -> Page:
        where, params = ["start_time >= ?", "start_time < ?"], [to_iso_z(start), to_iso_z(end)]
        if source:
            where.append("source = ?")
            params.append(source)
        if search:
            where.append(
                "(start_time LIKE ? OR settlement_date LIKE ? OR CAST(settlement_period AS TEXT) = ?)"
            )
            params += [f"%{search}%", f"%{search}%", search]
        return self._page(
            "actual_generation",
            "start_time, settlement_date, settlement_period, generation_mw,"
            " publish_time, source, ingested_at",
            where, params, sort if sort in ACTUAL_SORT_COLUMNS else "start_time",
            descending, page, page_size,
        )  # fmt: skip

    def page_forecasts(
        self,
        start: datetime,
        end: datetime,
        *,
        page: int,
        page_size: int,
        sort: str,
        descending: bool,
        publish_from: datetime | None = None,
        publish_to: datetime | None = None,
        source: str | None = None,
        search: str | None = None,
    ) -> Page:
        where, params = ["start_time >= ?", "start_time < ?"], [to_iso_z(start), to_iso_z(end)]
        if publish_from:
            where.append("publish_time >= ?")
            params.append(to_iso_z(publish_from))
        if publish_to:
            where.append("publish_time <= ?")
            params.append(to_iso_z(publish_to))
        if source:
            where.append("source = ?")
            params.append(source)
        if search:
            where.append("(start_time LIKE ? OR publish_time LIKE ?)")
            params += [f"%{search}%", f"%{search}%"]
        return self._page(
            "wind_forecast",
            "start_time, publish_time, generation_mw, source, ingested_at",
            where, params, sort if sort in FORECAST_SORT_COLUMNS else "start_time",
            descending, page, page_size,
        )  # fmt: skip

    def _page(
        self,
        table: str,
        columns: str,
        where: list[str],
        params: list[object],
        sort: str,
        descending: bool,
        page: int,
        page_size: int,
    ) -> Page:
        clause = " AND ".join(where)
        direction = "DESC" if descending else "ASC"
        tiebreak = "start_time" if sort != "start_time" else "rowid"
        with self.db.connection() as conn:
            total = conn.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE {clause}", params).fetchone()["n"]
            if page_size <= 0:
                rows = conn.execute(
                    f"SELECT {columns} FROM {table} WHERE {clause} ORDER BY {sort} {direction}, {tiebreak}",
                    params,
                ).fetchall()
            else:
                rows = conn.execute(
                    f"SELECT {columns} FROM {table} WHERE {clause}"
                    f" ORDER BY {sort} {direction}, {tiebreak} LIMIT ? OFFSET ?",
                    [*params, page_size, (page - 1) * page_size],
                ).fetchall()
        return Page(items=[dict(r) for r in rows], total=int(total))

    # ------------------------------------------------------------------ health reads
    def dataset_stats(self) -> dict[str, dict[str, object]]:
        with self.db.connection() as conn:
            actual = dict(
                conn.execute(
                    "SELECT COUNT(*) AS records, MIN(start_time) AS first_target,"
                    " MAX(start_time) AS last_target, MAX(ingested_at) AS last_ingested"
                    " FROM actual_generation"
                ).fetchone()
            )
            actual["by_source"] = {
                r["source"]: r["n"]
                for r in conn.execute("SELECT source, COUNT(*) AS n FROM actual_generation GROUP BY source")
            }
            forecast = dict(
                conn.execute(
                    "SELECT COUNT(*) AS records, MIN(start_time) AS first_target,"
                    " MAX(start_time) AS last_target, MIN(publish_time) AS first_publish,"
                    " MAX(publish_time) AS last_publish, COUNT(DISTINCT publish_time) AS vintages,"
                    " MAX(ingested_at) AS last_ingested FROM wind_forecast"
                ).fetchone()
            )
            forecast["by_source"] = {
                r["source"]: r["n"]
                for r in conn.execute("SELECT source, COUNT(*) AS n FROM wind_forecast GROUP BY source")
            }
        return {"actual": actual, "forecast": forecast}

    def refresh_history(self, limit: int = 20) -> list[dict[str, object]]:
        with self.db.connection() as conn:
            rows = conn.execute("SELECT * FROM refresh_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def last_refresh(self, dataset: str, *, successful_only: bool = False) -> dict[str, object] | None:
        query = "SELECT * FROM refresh_log WHERE dataset = ?"
        if successful_only:
            query += " AND status IN ('success', 'partial')"
        query += " ORDER BY id DESC LIMIT 1"
        with self.db.connection() as conn:
            row = conn.execute(query, (dataset,)).fetchone()
        return dict(row) if row else None

    def refresh_totals(self) -> dict[str, dict[str, int]]:
        with self.db.connection() as conn:
            rows = conn.execute(
                "SELECT dataset, COUNT(*) AS runs, SUM(retries) AS retries,"
                " SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failures,"
                " SUM(duplicates) AS duplicates, SUM(rejected) AS rejected,"
                " SUM(missing_publish_time) AS missing_publish_time"
                " FROM refresh_log GROUP BY dataset"
            ).fetchall()
        keys = [k for k in rows[0].keys() if k != "dataset"] if rows else []  # noqa: SIM118
        return {r["dataset"]: {k: int(r[k] or 0) for k in keys} for r in rows}
