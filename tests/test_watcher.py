import asyncio
import contextlib
import os
import time
from datetime import UTC, datetime
from pathlib import Path

from apiary.db import connect
from apiary.watcher import Hub, Watcher

from .fixtures import write_transcript


def drain(q) -> list[dict]:
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


def test_hub_fans_out_to_every_subscriber() -> None:
    hub = Hub()
    a, b = hub.subscribe(), hub.subscribe()
    hub.unsubscribe(b)
    hub.publish({"type": "x"})
    assert drain(a) == [{"type": "x"}]
    assert drain(b) == []


def test_run_once_publishes_updates_and_live_flips(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    write_transcript(claude, "/r/a", "l1", "working", start=datetime.now(UTC))
    conn = connect(tmp_path / "apiary.db")
    hub = Hub()
    q = hub.subscribe()
    w = Watcher(conn, claude, hub)

    now = time.time()
    w.run_once(now=now)
    events = drain(q)
    assert [e["type"] for e in events] == ["session.updated", "session.live", "index.progress"]
    assert (events[0]["session"]["id"], events[0]["session"]["status"]) == ("l1", "live")
    assert events[1] == {"type": "session.live", "id": "l1", "live": True}
    assert events[2]["report"]["indexed"] == 1

    assert w.run_once(now=now + 1).changed == []
    assert drain(q) == []

    w.run_once(now=now + 3600)
    events = drain(q)
    assert {"type": "session.live", "id": "l1", "live": False} in events
    assert next(e for e in events if e["type"] == "session.updated")["session"]["status"] == "idle"


def test_file_changes_are_pushed_to_subscribers(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    claude.mkdir()
    conn = connect(tmp_path / "apiary.db")

    async def main() -> dict:
        hub = Hub()
        q = hub.subscribe()
        w = Watcher(conn, claude, hub, tick_seconds=3600, debounce_ms=100)
        task = asyncio.create_task(w.run())
        try:
            p = write_transcript(claude, "/r/a", "f1", "typed just now", start=datetime.now(UTC))
            for _attempt in range(5):
                try:
                    while True:
                        e = await asyncio.wait_for(q.get(), timeout=2)
                        if e["type"] == "session.updated":
                            return e
                except TimeoutError:
                    os.utime(p, None)  # the watcher may have attached after the first write
            raise AssertionError("no session.updated event")
        finally:
            w.stop()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    event = asyncio.run(main())
    assert event["session"]["id"] == "f1"
