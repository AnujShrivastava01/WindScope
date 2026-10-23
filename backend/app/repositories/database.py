"""SQLite storage with versioned schema migrations.

SQLite keeps the application runnable with zero external services while still
providing uniqueness constraints, indexes and durable refresh metadata. Writes are
serialised by a process-wide lock; reads use short-lived connections.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS: list[str] = [
    # 1: core tables
    """
    CREATE TABLE IF NOT EXISTS actual_generation (
        start_time TEXT PRIMARY KEY,
        settlement_date TEXT,
        settlement_period INTEGER,
        generation_mw REAL NOT NULL,
        publish_time TEXT,
        source TEXT NOT NULL,
        ingested_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wind_forecast (
        start_time TEXT NOT NULL,
        publish_time TEXT NOT NULL,
        generation_mw REAL NOT NULL,
        source TEXT NOT NULL,
        ingested_at TEXT NOT NULL,
        PRIMARY KEY (start_time, publish_time)
    );
    CREATE INDEX IF NOT EXISTS ix_wind_forecast_publish ON wind_forecast (publish_time);
    CREATE INDEX IF NOT EXISTS ix_actual_settlement ON actual_generation (settlement_date);
    CREATE TABLE IF NOT EXISTS refresh_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        retries INTEGER NOT NULL DEFAULT 0,
        received INTEGER NOT NULL DEFAULT 0,
        inserted INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL DEFAULT 0,
        unchanged INTEGER NOT NULL DEFAULT 0,
        rejected INTEGER NOT NULL DEFAULT 0,
        duplicates INTEGER NOT NULL DEFAULT 0,
        duplicate_conflicts INTEGER NOT NULL DEFAULT 0,
        missing_publish_time INTEGER NOT NULL DEFAULT 0,
        error TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_refresh_log_dataset ON refresh_log (dataset, finished_at);
    CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """,
]


class Database:
    def __init__(self, path: Path | str) -> None:
        self.path = str(path)
        self._memory = self.path == ":memory:"
        self.write_lock = threading.RLock()
        self._shared: sqlite3.Connection | None = None
        if self._memory:
            # A single shared connection keeps an in-memory database alive (tests).
            self._shared = sqlite3.connect(":memory:", check_same_thread=False)
            self._shared.row_factory = sqlite3.Row
        else:
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        if self._shared is not None:
            return self._shared
        conn = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            if conn is not self._shared:
                conn.close()

    def migrate(self) -> int:
        with self.write_lock, self.connection() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
            row = conn.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()
            current = row["v"] or 0
            for version, script in enumerate(MIGRATIONS, start=1):
                if version > current:
                    conn.executescript(script)
                    conn.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))
            return len(MIGRATIONS)

    def ping(self) -> bool:
        try:
            with self.connection() as conn:
                conn.execute("SELECT 1").fetchone()
            return True
        except sqlite3.Error:
            return False
