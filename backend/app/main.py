"""FastAPI application factory."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.deps import Container
from app.api.routes import analysis, records, system
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.repositories.database import Database
from app.repositories.records import RecordsRepository
from app.services.analysis import AnalysisService
from app.services.elexon_client import ElexonClient
from app.services.ingestion import IngestionService

logger = logging.getLogger("windscope")


def build_container(
    settings: Settings, client_factory: Callable[[], ElexonClient] | None = None
) -> Container:
    db = Database(settings.database_path)
    db.migrate()
    repo = RecordsRepository(db)
    return Container(
        settings=settings,
        repo=repo,
        analysis=AnalysisService(repo),
        ingestion=IngestionService(repo, settings, client_factory),
    )


def create_app(
    settings: Settings | None = None,
    client_factory: Callable[[], ElexonClient] | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        container = build_container(settings, client_factory)
        app.state.container = container
        stats = container.repo.dataset_stats()
        empty = not stats["actual"]["records"] or not stats["forecast"]["records"]
        if settings.auto_ingest_on_startup and empty:
            logger.info("store is empty; starting initial Elexon ingestion in background")
            threading.Thread(target=container.ingestion.refresh, args=("startup",), daemon=True).start()
        yield

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Day-ahead wind forecast vintage selection and accuracy analytics for GB national wind "
            "generation, using Elexon BMRS FUELHH (actuals) and WINDFOR (forecasts)."
        ),
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition", "X-Record-Count", "X-Request-ID"],
    )

    @app.middleware("http")
    async def request_logging(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        started = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response

    register_error_handlers(app)
    app.include_router(system.router)
    app.include_router(analysis.router)
    app.include_router(records.router)

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {"name": settings.app_name, "docs": "/api/docs", "health": "/api/health"}

    return app


app = create_app()
