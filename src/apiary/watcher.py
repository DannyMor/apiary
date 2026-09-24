"""Keep the index current and tell subscribers what changed.

``Watcher.run`` re-indexes when files under ``claude_dir`` change and on a timer (a live
session turns idle through silence, which no file event announces). Every run publishes
to the ``Hub``:

    {"type": "session.updated", "session": SessionOut}   a row was indexed, purged or flipped
    {"type": "session.live",    "id": str, "live": bool}  a session started or stopped running
    {"type": "index.progress",  "report": IndexReport}    after any run that published something

The API publishes on the same hub when a person curates:

    {"type": "group.updated",   "group": Group}            created, renamed, recolored, members changed
    {"type": "group.deleted",   "id": str}                 a swarm was dissolved
    {"type": "settings.updated", "settings": dict}         the merged settings after a PUT
    plus session.updated for every session whose groups, tags or decision changed
"""

from __future__ import annotations

import asyncio
import dataclasses
import sqlite3
from pathlib import Path

from watchfiles import awatch

from apiary.indexer import IndexReport, index_all
from apiary.queries import fetch_session

TICK_SECONDS = 30.0
DEBOUNCE_MS = 2000


class Hub:
    def __init__(self) -> None:
        self._queues: set[asyncio.Queue[dict]] = set()

    def subscribe(self) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue()
        self._queues.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self._queues.discard(queue)

    def publish(self, event: dict) -> None:
        for queue in self._queues:
            queue.put_nowait(event)


class Watcher:
    def __init__(
        self,
        conn: sqlite3.Connection,
        claude_dir: Path,
        hub: Hub,
        *,
        tick_seconds: float = TICK_SECONDS,
        debounce_ms: int = DEBOUNCE_MS,
    ) -> None:
        self.conn = conn
        self.claude_dir = claude_dir
        self.hub = hub
        self.tick_seconds = tick_seconds
        self.debounce_ms = debounce_ms
        self.last = IndexReport()
        self._live = self._live_ids()
        self._stop: asyncio.Event | None = None

    def run_once(self, now: float | None = None) -> IndexReport:
        report = index_all(self.conn, self.claude_dir, now)
        live = self._live_ids()
        flipped = live ^ self._live
        self._live = live
        for session_id in [*report.changed, *sorted(flipped - set(report.changed))]:
            session = fetch_session(self.conn, session_id)
            if session:
                self.hub.publish({"type": "session.updated", "session": session.model_dump()})
        for session_id in sorted(flipped):
            self.hub.publish({"type": "session.live", "id": session_id, "live": session_id in live})
        if report.changed or flipped:
            self.hub.publish({"type": "index.progress", "report": dataclasses.asdict(report)})
        self.last = report
        return report

    async def run(self) -> None:
        """Index on file changes and on the tick until cancelled or ``stop()`` is called."""
        self._stop = asyncio.Event()
        async with asyncio.TaskGroup() as group:
            group.create_task(self._tick())
            if self.claude_dir.is_dir():
                group.create_task(self._watch())

    def stop(self) -> None:
        if self._stop is not None:
            self._stop.set()

    async def _watch(self) -> None:
        async for _ in awatch(
            self.claude_dir, debounce=self.debounce_ms, stop_event=self._stop, rust_timeout=1000
        ):
            self.run_once()

    async def _tick(self) -> None:
        assert self._stop is not None
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.tick_seconds)
            except TimeoutError:
                self.run_once()

    def _live_ids(self) -> set[str]:
        return {r["id"] for r in self.conn.execute("SELECT id FROM sessions WHERE status='live'")}
