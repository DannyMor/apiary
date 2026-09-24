"""What the person curates: swarms (custom groups), tags and keeper decisions.

Repo hives are the indexer's: their members cannot be edited here and they cannot be
deleted, but they can be renamed and recolored.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any

from apiary.colors import suggest
from apiary.db import transaction


class UnknownId(KeyError):
    """No such session or group."""


class RepoHive(ValueError):
    """The operation is only valid on a swarm, not on a repo hive."""


def create_swarm(conn: sqlite3.Connection, name: str, color: str | None, member_ids: list[str]) -> str:
    _require_sessions(conn, member_ids)
    group_id = f"swarm:{uuid.uuid4().hex[:8]}"
    if color is None:
        taken = [r["color"] for r in conn.execute("SELECT color FROM groups WHERE color IS NOT NULL")]
        color = suggest(taken, 1)[0]
    with transaction(conn):
        conn.execute(
            "INSERT INTO groups(id, name, kind, color) VALUES(?, ?, 'custom', ?)", (group_id, name, color)
        )
        conn.executemany(
            "INSERT INTO group_members(group_id, session_id) VALUES(?, ?) ON CONFLICT DO NOTHING",
            [(group_id, sid) for sid in member_ids],
        )
    return group_id


def update_group(conn: sqlite3.Connection, group_id: str, name: str | None, color: str | None) -> None:
    _require_group(conn, group_id)
    with transaction(conn):
        if name is not None:
            conn.execute("UPDATE groups SET name=? WHERE id=?", (name, group_id))
        if color is not None:
            conn.execute("UPDATE groups SET color=? WHERE id=?", (color, group_id))


def delete_group(conn: sqlite3.Connection, group_id: str) -> list[str]:
    """Delete a swarm; returns the ids of the sessions that were in it."""
    _require_swarm(conn, group_id)
    members = [
        r["session_id"]
        for r in conn.execute("SELECT session_id FROM group_members WHERE group_id=?", (group_id,))
    ]
    with transaction(conn):
        conn.execute("DELETE FROM groups WHERE id=?", (group_id,))
    return members


def add_members(conn: sqlite3.Connection, group_id: str, session_ids: list[str]) -> None:
    _require_swarm(conn, group_id)
    _require_sessions(conn, session_ids)
    with transaction(conn):
        conn.executemany(
            "INSERT INTO group_members(group_id, session_id) VALUES(?, ?) ON CONFLICT DO NOTHING",
            [(group_id, sid) for sid in session_ids],
        )


def remove_member(conn: sqlite3.Connection, group_id: str, session_id: str) -> None:
    _require_swarm(conn, group_id)
    with transaction(conn):
        conn.execute("DELETE FROM group_members WHERE group_id=? AND session_id=?", (group_id, session_id))


def add_tag(conn: sqlite3.Connection, session_id: str, tag: str) -> None:
    _require_sessions(conn, [session_id])
    with transaction(conn):
        conn.execute(
            "INSERT INTO tags(session_id, tag) VALUES(?, ?) ON CONFLICT DO NOTHING", (session_id, tag)
        )


def remove_tag(conn: sqlite3.Connection, session_id: str, tag: str) -> None:
    _require_sessions(conn, [session_id])
    with transaction(conn):
        conn.execute("DELETE FROM tags WHERE session_id=? AND tag=?", (session_id, tag))


def tag_counts(conn: sqlite3.Connection) -> list[tuple[str, int]]:
    rows = conn.execute(
        "SELECT t.tag, COUNT(*) AS n FROM tags t JOIN sessions s ON s.id=t.session_id "
        "WHERE s.status != 'purged' GROUP BY t.tag ORDER BY t.tag"
    )
    return [(r["tag"], r["n"]) for r in rows]


def set_decision(conn: sqlite3.Connection, session_id: str, decision: str) -> None:
    _require_sessions(conn, [session_id])
    with transaction(conn):
        conn.execute(
            "INSERT INTO gc_decisions(session_id, decision, decided_at) VALUES(?, ?, ?) "
            "ON CONFLICT(session_id) DO UPDATE SET decision=excluded.decision, "
            "decided_at=excluded.decided_at, applied_at=NULL, summary_path=NULL",
            (session_id, decision, time.time()),
        )


def clear_decision(conn: sqlite3.Connection, session_id: str) -> None:
    _require_sessions(conn, [session_id])
    with transaction(conn):
        conn.execute("DELETE FROM gc_decisions WHERE session_id=?", (session_id,))


def candidate_ids(conn: sqlite3.Connection, threshold: int) -> list[str]:
    """Idle sessions scoring below ``threshold`` that the person has not marked ``keep``, worst first."""
    rows = conn.execute(
        "SELECT s.id FROM sessions s JOIN scores sc ON sc.session_id = s.id "
        "LEFT JOIN gc_decisions d ON d.session_id = s.id "
        "WHERE s.status = 'idle' AND sc.score < ? AND (d.decision IS NULL OR d.decision != 'keep') "
        "ORDER BY sc.score ASC, s.last_active_at ASC",
        (threshold,),
    )
    return [r["id"] for r in rows]


def get_settings(conn: sqlite3.Connection) -> dict[str, Any]:
    return {
        r["key"]: json.loads(r["value"]) for r in conn.execute("SELECT key, value FROM settings ORDER BY key")
    }


def put_settings(conn: sqlite3.Connection, patch: dict[str, Any]) -> dict[str, Any]:
    """Merge ``patch`` into the stored settings; a ``None`` value removes the key."""
    with transaction(conn):
        for key, value in patch.items():
            if value is None:
                conn.execute("DELETE FROM settings WHERE key=?", (key,))
            else:
                conn.execute(
                    "INSERT INTO settings(key, value) VALUES(?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (key, json.dumps(value)),
                )
    return get_settings(conn)


def _require_group(conn: sqlite3.Connection, group_id: str) -> str:
    row = conn.execute("SELECT kind FROM groups WHERE id=?", (group_id,)).fetchone()
    if not row:
        raise UnknownId(group_id)
    return row["kind"]


def _require_swarm(conn: sqlite3.Connection, group_id: str) -> None:
    if _require_group(conn, group_id) != "custom":
        raise RepoHive(group_id)


def _require_sessions(conn: sqlite3.Connection, session_ids: list[str]) -> None:
    for sid in session_ids:
        if not conn.execute("SELECT 1 FROM sessions WHERE id=?", (sid,)).fetchone():
            raise UnknownId(sid)
