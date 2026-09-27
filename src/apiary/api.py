"""HTTP API, websocket events and static UI.

``create_app(config)`` builds the FastAPI app; ``apiary serve`` runs it with uvicorn.
All endpoints are ``async`` so the single SQLite connection is only ever used from
the event loop thread; the watcher runs on that loop too.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from apiary import __version__, colors, curation, keeper
from apiary.config import Config
from apiary.curation import RepoHive, UnknownId
from apiary.db import connect
from apiary.indexer import IndexReport
from apiary.keeper import ClaudeCli, NotArchived, Summarizer
from apiary.models import (
    ApplyReport,
    DecisionIn,
    Failure,
    Group,
    GroupPatch,
    Health,
    HoneyOut,
    MembersIn,
    PurgeIn,
    SessionOut,
    SwarmIn,
    TagCount,
    TagIn,
)
from apiary.openers import ClaudeCliOpener, ClaudeDesktopOpener, Opener, platform_launch
from apiary.queries import SESSION_SQL, fetch_group, fetch_groups, fetch_session, session_out
from apiary.watcher import Hub, Watcher

WEB_DIR = Path(__file__).resolve().parents[2] / "web"

SORTS = {
    "last_active": "s.last_active_at DESC",
    "created": "s.created_at DESC",
    "score": "sc.score DESC, s.last_active_at DESC",
    "name": "s.title COLLATE NOCASE ASC",
}


def create_app(
    config: Config | None = None,
    summarizer: Summarizer | None = None,
    openers: list[Opener] | None = None,
    launcher: Callable[[str], None] = platform_launch,
) -> FastAPI:
    config = config or Config.load()
    config.ensure_dirs()
    summarizer = summarizer or ClaudeCli(config.keeper.summarizer, config.keeper.summary_timeout_s)
    if openers is None:
        d = config.desktop_app
        openers = [ClaudeDesktopOpener(d.registry_dir, d.transcript_key, d.link), ClaudeCliOpener()]

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.config = config
        app.state.summarizer = summarizer
        app.state.openers = openers
        app.state.db = connect(config.paths.db)
        app.state.hub = Hub()
        app.state.watcher = Watcher(app.state.db, config.paths.claude_dir, app.state.hub, openers=openers)
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

    @app.exception_handler(NotArchived)
    async def not_archived(_: Request, exc: NotArchived) -> JSONResponse:
        return JSONResponse({"detail": f"{exc.args[0]} is not archived"}, status_code=409)

    @app.exception_handler(FileNotFoundError)
    async def file_missing(_: Request, exc: FileNotFoundError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

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
        return [session_out(app.state.db, r, app.state.openers) for r in rows]

    @app.get("/api/sessions/{session_id}", response_model=SessionOut)
    async def session(session_id: str) -> SessionOut:
        found = fetch_session(app.state.db, session_id, app.state.openers)
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

    @app.get("/api/colors/suggest", response_model=list[str])
    async def suggest_colors(
        n: Annotated[int, Query(ge=1, le=12)] = 4,
        exclude: Annotated[
            list[str] | None, Query(description='extra "l c h" colors to steer clear of')
        ] = None,
    ) -> list[str]:
        taken = [g.color for g in fetch_groups(app.state.db) if g.color]
        return colors.suggest([*taken, *(exclude or [])], n)

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
        found = (
            fetch_session(app.state.db, sid, app.state.openers)
            for sid in curation.candidate_ids(app.state.db, threshold)
        )
        return [s for s in found if s is not None]

    @app.post("/api/gc/decisions", response_model=SessionOut)
    async def decide(body: DecisionIn) -> SessionOut:
        curation.set_decision(app.state.db, body.session_id, body.decision)
        return _session_changed(app, body.session_id)

    @app.delete("/api/gc/decisions/{session_id}", response_model=SessionOut)
    async def undecide(session_id: str) -> SessionOut:
        curation.clear_decision(app.state.db, session_id)
        return _session_changed(app, session_id)

    @app.post("/api/gc/apply", response_model=ApplyReport)
    async def gc_apply() -> ApplyReport:
        """Archive every pending decision, honey first where asked; one failure does not stop the rest."""
        report = ApplyReport()
        pending = app.state.db.execute(
            "SELECT session_id, decision FROM gc_decisions WHERE applied_at IS NULL "
            "AND decision IN ('archive', 'summarize_archive') ORDER BY session_id"
        ).fetchall()
        for row in pending:
            session_id = row["session_id"]
            try:
                if row["decision"] == "summarize_archive":
                    await _make_honey(app, session_id)
                    report.summarized.append(session_id)
                keeper.archive(app.state.db, config, session_id)
                report.archived.append(session_id)
                _session_changed(app, session_id)
            except Exception as exc:
                report.failed.append(Failure(session_id=session_id, error=str(exc)))
        return report

    @app.post("/api/gc/purge")
    async def gc_purge(body: PurgeIn) -> dict[str, list[str]]:
        keeper.purge(app.state.db, body.session_ids)
        _sessions_changed(app, body.session_ids)
        return {"purged": body.session_ids}

    @app.post("/api/sessions/{session_id}/summarize", response_model=HoneyOut)
    async def summarize(session_id: str) -> HoneyOut:
        try:
            path = await _make_honey(app, session_id)
        except RuntimeError as exc:
            raise HTTPException(502, f"summarizer failed: {exc}") from exc
        _session_changed(app, session_id)
        return HoneyOut(path=str(path), text=path.read_text())

    @app.get("/api/sessions/{session_id}/honey", response_class=PlainTextResponse)
    async def honey(session_id: str) -> PlainTextResponse:
        row = app.state.db.execute("SELECT honey FROM sessions WHERE id=?", (session_id,)).fetchone()
        if row is None:
            raise UnknownId(session_id)
        if not row["honey"] or not Path(row["honey"]).is_file():
            raise HTTPException(404, "no honey for this session")
        return PlainTextResponse(Path(row["honey"]).read_text(), media_type="text/markdown")

    @app.post("/api/sessions/{session_id}/restore", response_model=SessionOut)
    async def restore(session_id: str) -> SessionOut:
        keeper.restore(app.state.db, session_id)
        return _session_changed(app, session_id)

    @app.post("/api/sessions/{session_id}/open", status_code=204)
    async def open_session(session_id: str) -> Response:
        """Open the session where it lives, from this machine: the browser may not forward claude:// links."""
        session = fetch_session(app.state.db, session_id, app.state.openers)
        if session is None:
            raise UnknownId(session_id)
        url = next((o.url for o in session.openings if o.url), None)
        if url is None:
            raise HTTPException(409, "nothing to open for this session from here")
        await asyncio.to_thread(launcher, url)
        return Response(status_code=204)

    @app.post("/api/scores/recompute")
    async def recompute() -> dict[str, int]:
        return {"rescored": keeper.recompute_scores(app.state.db)}

    @app.get("/api/settings")
    async def settings() -> dict[str, Any]:
        return curation.get_settings(app.state.db)

    @app.put("/api/settings")
    async def put_settings(body: dict[str, Any]) -> dict[str, Any]:
        merged = curation.put_settings(app.state.db, body)
        app.state.hub.publish({"type": "settings.updated", "settings": merged})
        return merged

    _mount_ui(app)
    return app


async def _make_honey(app: FastAPI, session_id: str) -> Path:
    """The summarizer runs in a worker thread; the database is only touched from the loop thread."""
    config = app.state.config
    prompt, text = keeper.summary_input(app.state.db, config, session_id)
    body = await asyncio.to_thread(app.state.summarizer, prompt, text)
    return keeper.write_honey(app.state.db, config, session_id, body)


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
    session = fetch_session(app.state.db, session_id, app.state.openers)
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
    """Serve the built UI if present, else the prototype, else a hint. The prototype always has /prototype."""
    dist = WEB_DIR / "dist"
    proto = WEB_DIR / "prototype" / "apiary.html"
    if proto.is_file():

        @app.get("/prototype", include_in_schema=False)
        async def prototype_page() -> FileResponse:
            return FileResponse(proto)

    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
    elif proto.is_file():

        @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
        async def prototype() -> FileResponse:
            return FileResponse(proto)

    else:

        @app.get("/", include_in_schema=False)
        async def placeholder() -> JSONResponse:
            return JSONResponse({"apiary": __version__, "ui": "not built yet", "api": "/api/health"})
