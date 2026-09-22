"""HTTP API and static UI.

``create_app(config)`` builds the FastAPI app; ``apiary serve`` runs it with uvicorn.
All endpoints are ``async`` so the single SQLite connection is only ever used from
the event loop thread. Routers for sessions, groups, scoring and GC arrive in later stages.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from apiary import __version__
from apiary.config import Config
from apiary.db import connect
from apiary.models import Health

WEB_DIR = Path(__file__).resolve().parents[2] / "web"


def create_app(config: Config | None = None) -> FastAPI:
    config = config or Config.load()
    config.ensure_dirs()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.config = config
        app.state.db = connect(config.paths.db)
        try:
            yield
        finally:
            app.state.db.close()

    app = FastAPI(title="Apiary", version=__version__, lifespan=lifespan)

    @app.get("/api/health", response_model=Health)
    async def health() -> Health:
        count = app.state.db.execute("SELECT COUNT(*) AS n FROM sessions").fetchone()["n"]
        return Health(
            version=__version__,
            db=str(config.paths.db),
            claude_dir=str(config.paths.claude_dir),
            sessions=count,
        )

    _mount_ui(app)
    return app


def _mount_ui(app: FastAPI) -> None:
    """Serve the built UI if present, else the prototype, else a hint."""
    dist = WEB_DIR / "dist"
    proto = WEB_DIR / "prototype" / "apiary.html"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
    elif proto.is_file():

        @app.get("/", include_in_schema=False)
        async def prototype() -> FileResponse:
            return FileResponse(proto)

    else:

        @app.get("/", include_in_schema=False)
        async def placeholder() -> JSONResponse:
            return JSONResponse({"apiary": __version__, "ui": "not built yet", "api": "/api/health"})
