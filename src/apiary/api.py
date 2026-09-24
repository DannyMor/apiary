"""HTTP API, websocket events and static UI.

``create_app(config)`` builds the FastAPI app; ``apiary serve`` runs it with uvicorn.
All endpoints are ``async`` so the single SQLite connection is only ever used from
the event loop thread; the watcher runs on that loop too.
"""

from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from apiary import __version__, curation
from apiary.config import Config
from apiary.curation import RepoHive, UnknownId
from apiary.db import connect
from apiary.indexer import IndexReport
from apiary.models import (
    DecisionIn,
    Group,
    GroupPatch,
    Health,
    MembersIn,
    SessionOut,
    SwarmIn,
    TagCount,
    TagIn,
)
from apiary.queries import SESSION_SQL, fetch_group, fetch_groups, fetch_session, session_out
from apiary.watcher import Hub, Watcher

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
        app.state.hub = Hub()
        app.state.watcher = Watcher(app.state.db, config.paths.claude_dir, app.state.hub)
        app.state.watcher.run_once()
        watching = asyncio.create_task(app.state.watcher.run())
        try:
            yield
        finally:
            app.state.watcher.stop()
            watching.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await watching
            app.state.db.close()

    app = FastAPI(title="Apiary", version=__version__, lifespan=lifespan)

    @app.exception_handler(UnknownId)
    async def unknown_id(_: Request, exc: UnknownId) -> JSONResponse:
        return JSONResponse({"detail": f"no such id: {exc.args[0]}"}, status_code=404)

    @app.exception_handler(RepoHive)
    async def repo_hive(_: Request, exc: RepoHive) -> JSONResponse:
        return JSONResponse(
            {"detail": f"{exc.args[0]} is a repo hive; the indexer owns its members"}, status_code=409
        )

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
        return app.state.watcher.run_once()

    @app.get("/api/index/status", response_model=IndexReport)
    async def index_status() -> IndexReport:
        return app.state.watcher.last

    @app.websocket("/api/events")
    async def events(ws: WebSocket) -> None:
        await ws.accept()
        queue = app.state.hub.subscribe()
        try:
            async with asyncio.TaskGroup() as group:
                group.create_task(_forward(ws, queue))
                group.create_task(_until_closed(ws))
        except* WebSocketDisconnect:
            pass
        finally:
            app.state.hub.unsubscribe(queue)

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
            f"""{SESSION_SQL} WHERE {" AND ".join(where)} ORDER BY {SORTS[sort]} LIMIT ?""",
            [*args, limit],
        ).fetchall()
        return [session_out(app.state.db, r) for r in rows]

    @app.get("/api/sessions/{session_id}", response_model=SessionOut)
    async def session(session_id: str) -> SessionOut:
        found = fetch_session(app.state.db, session_id)
        if found is None:
            raise HTTPException(404, "no such session")
        return found

    @app.get("/api/groups", response_model=list[Group])
    async def groups() -> list[Group]:
        return fetch_groups(app.state.db)

    @app.post("/api/groups", response_model=Group, status_code=201)
    async def create_swarm(body: SwarmIn) -> Group:
        group_id = curation.create_swarm(app.state.db, body.name, body.color, body.member_ids)
        return _group_changed(app, group_id, body.member_ids)

    @app.patch("/api/groups/{group_id}", response_model=Group)
    async def update_group(group_id: str, body: GroupPatch) -> Group:
        curation.update_group(app.state.db, group_id, body.name, body.color)
        return _group_changed(app, group_id, [])

    @app.delete("/api/groups/{group_id}", status_code=204)
    async def delete_swarm(group_id: str) -> Response:
        members = curation.delete_group(app.state.db, group_id)
        app.state.hub.publish({"type": "group.deleted", "id": group_id})
        _sessions_changed(app, members)
        return Response(status_code=204)

    @app.post("/api/groups/{group_id}/members", response_model=Group)
    async def add_members(group_id: str, body: MembersIn) -> Group:
        curation.add_members(app.state.db, group_id, body.session_ids)
        return _group_changed(app, group_id, body.session_ids)

    @app.delete("/api/groups/{group_id}/members/{session_id}", response_model=Group)
    async def remove_member(group_id: str, session_id: str) -> Group:
        curation.remove_member(app.state.db, group_id, session_id)
        return _group_changed(app, group_id, [session_id])

    @app.get("/api/tags", response_model=list[TagCount])
    async def tags() -> list[TagCount]:
        return [TagCount(tag=tag, count=count) for tag, count in curation.tag_counts(app.state.db)]

    @app.post("/api/sessions/{session_id}/tags", response_model=SessionOut)
    async def add_tag(session_id: str, body: TagIn) -> SessionOut:
        curation.add_tag(app.state.db, session_id, body.tag)
        return _session_changed(app, session_id)

    @app.delete("/api/sessions/{session_id}/tags/{tag}", response_model=SessionOut)
    async def remove_tag(session_id: str, tag: str) -> SessionOut:
        curation.remove_tag(app.state.db, session_id, tag)
        return _session_changed(app, session_id)

    @app.get("/api/gc/candidates", response_model=list[SessionOut])
    async def gc_candidates(threshold: int = Query(35, ge=0, le=100)) -> list[SessionOut]:
        found = (fetch_session(app.state.db, sid) for sid in curation.candidate_ids(app.state.db, threshold))
        return [s for s in found if s is not None]

    @app.post("/api/gc/decisions", response_model=SessionOut)
    async def decide(body: DecisionIn) -> SessionOut:
        curation.set_decision(app.state.db, body.session_id, body.decision)
        return _session_changed(app, body.session_id)

    @app.delete("/api/gc/decisions/{session_id}", response_model=SessionOut)
    async def undecide(session_id: str) -> SessionOut:
        curation.clear_decision(app.state.db, session_id)
        return _session_changed(app, session_id)

    _mount_ui(app)
    return app


def _group_changed(app: FastAPI, group_id: str, session_ids: list[str]) -> Group:
    group = fetch_group(app.state.db, group_id)
    assert group is not None
    app.state.hub.publish({"type": "group.updated", "group": group.model_dump()})
    _sessions_changed(app, session_ids)
    return group


def _sessions_changed(app: FastAPI, session_ids: list[str]) -> None:
    for session_id in session_ids:
        if fetch_session(app.state.db, session_id):
            _session_changed(app, session_id)


def _session_changed(app: FastAPI, session_id: str) -> SessionOut:
    session = fetch_session(app.state.db, session_id)
    if session is None:
        raise UnknownId(session_id)
    app.state.hub.publish({"type": "session.updated", "session": session.model_dump()})
    return session


async def _forward(ws: WebSocket, queue: asyncio.Queue[dict]) -> None:
    while True:
        await ws.send_json(await queue.get())


async def _until_closed(ws: WebSocket) -> None:
    """Consume (and ignore) client frames so a disconnect is noticed even when nothing is being sent."""
    while True:
        await ws.receive_text()


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
