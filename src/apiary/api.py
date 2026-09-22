"""HTTP API and static UI.

``create_app(config)`` builds the FastAPI app; ``apiary serve`` runs it with uvicorn.
All endpoints are ``async`` so the single SQLite connection is only ever used from
the event loop thread.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from apiary import __version__
from apiary.config import Config
from apiary.db import connect
from apiary.indexer import IndexReport, index_all
from apiary.models import Group, Health, Session, SessionOut

WEB_DIR = Path(__file__).resolve().parents[2] / "web"

SORTS = {
    "last_active": "s.last_active_at DESC",
    "created": "s.created_at DESC",
    "score": "sc.score DESC, s.last_active_at DESC",
    "name": "s.title COLLATE NOCASE ASC",
}


def create_app(config: Config | None = None) -> FastAPI:
    config = config or Config.load()
    config.ensure_dirs()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.config = config
        app.state.db = connect(config.paths.db)
        app.state.last_index = index_all(app.state.db, config.paths.claude_dir)
        try:
            yield
        finally:
            app.state.db.close()

    app = FastAPI(title="Apiary", version=__version__, lifespan=lifespan)

    @app.get("/api/health", response_model=Health)
    async def health() -> Health:
        count = app.state.db.execute(
            "SELECT COUNT(*) AS n FROM sessions WHERE status != 'purged'"
        ).fetchone()["n"]
        return Health(
            version=__version__,
            db=str(config.paths.db),
            claude_dir=str(config.paths.claude_dir),
            sessions=count,
        )

    @app.post("/api/index/refresh", response_model=IndexReport)
    async def refresh() -> IndexReport:
        app.state.last_index = index_all(app.state.db, config.paths.claude_dir)
        return app.state.last_index

    @app.get("/api/index/status", response_model=IndexReport)
    async def index_status() -> IndexReport:
        return app.state.last_index

    @app.get("/api/sessions", response_model=list[SessionOut])
    async def sessions(
        sort: Literal["last_active", "created", "score", "name"] = "last_active",
        group: str | None = Query(None, description="group id, e.g. repo:api-server"),
        status: str | None = Query(None, description="live | idle | archived | purged"),
        limit: int = Query(500, ge=1, le=5000),
    ) -> list[SessionOut]:
        where, args = ["1=1"], []
        if group:
            where.append("s.id IN (SELECT session_id FROM group_members WHERE group_id=?)")
            args.append(group)
        if status:
            where.append("s.status=?")
            args.append(status)
        else:
            where.append("s.status != 'purged'")
        rows = app.state.db.execute(
            f"""SELECT s.*, sc.score, sc.reasons FROM sessions s
                LEFT JOIN scores sc ON sc.session_id = s.id
                WHERE {" AND ".join(where)} ORDER BY {SORTS[sort]} LIMIT ?""",
            [*args, limit],
        ).fetchall()
        return [_session_out(app, r) for r in rows]

    @app.get("/api/sessions/{session_id}", response_model=SessionOut)
    async def session(session_id: str) -> SessionOut:
        row = app.state.db.execute(
            "SELECT s.*, sc.score, sc.reasons FROM sessions s "
            "LEFT JOIN scores sc ON sc.session_id=s.id WHERE s.id=?",
            (session_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "no such session")
        return _session_out(app, row)

    @app.get("/api/groups", response_model=list[Group])
    async def groups() -> list[Group]:
        out = []
        for g in app.state.db.execute("SELECT * FROM groups ORDER BY kind, name").fetchall():
            members = [
                r["session_id"]
                for r in app.state.db.execute(
                    "SELECT gm.session_id FROM group_members gm JOIN sessions s ON s.id=gm.session_id "
                    "WHERE gm.group_id=? AND s.status != 'purged'",
                    (g["id"],),
                )
            ]
            out.append(
                Group(id=g["id"], name=g["name"], kind=g["kind"], color=g["color"], member_ids=members)
            )
        return out

    _mount_ui(app)
    return app


def _session_out(app: FastAPI, row) -> SessionOut:
    base = Session(**{k: row[k] for k in Session.model_fields})
    tags = [r["tag"] for r in app.state.db.execute("SELECT tag FROM tags WHERE session_id=?", (row["id"],))]
    groups = [
        r["group_id"]
        for r in app.state.db.execute("SELECT group_id FROM group_members WHERE session_id=?", (row["id"],))
    ]
    return SessionOut(
        **base.model_dump(),
        score=row["score"] if row["score"] is not None else 0,
        reasons=json.loads(row["reasons"]) if row["reasons"] else [],
        tags=tags,
        groups=groups,
    )


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
