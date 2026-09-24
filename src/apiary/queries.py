"""Load sessions the way the API and the event stream serve them."""

from __future__ import annotations

import json
import sqlite3

from apiary.models import Group, Session, SessionOut

SESSION_SQL = "SELECT s.*, sc.score, sc.reasons FROM sessions s LEFT JOIN scores sc ON sc.session_id = s.id"


def session_out(conn: sqlite3.Connection, row: sqlite3.Row) -> SessionOut:
    base = Session(**{k: row[k] for k in Session.model_fields})
    tags = [r["tag"] for r in conn.execute("SELECT tag FROM tags WHERE session_id=?", (row["id"],))]
    groups = [
        r["group_id"]
        for r in conn.execute("SELECT group_id FROM group_members WHERE session_id=?", (row["id"],))
    ]
    return SessionOut(
        **base.model_dump(),
        score=row["score"] if row["score"] is not None else 0,
        reasons=json.loads(row["reasons"]) if row["reasons"] else [],
        tags=tags,
        groups=groups,
    )


def fetch_session(conn: sqlite3.Connection, session_id: str) -> SessionOut | None:
    row = conn.execute(f"{SESSION_SQL} WHERE s.id=?", (session_id,)).fetchone()
    return session_out(conn, row) if row else None


def fetch_group(conn: sqlite3.Connection, group_id: str) -> Group | None:
    row = conn.execute("SELECT * FROM groups WHERE id=?", (group_id,)).fetchone()
    return _group(conn, row) if row else None


def fetch_groups(conn: sqlite3.Connection) -> list[Group]:
    return [_group(conn, row) for row in conn.execute("SELECT * FROM groups ORDER BY kind, name, id")]


def _group(conn: sqlite3.Connection, row: sqlite3.Row) -> Group:
    members = [
        r["session_id"]
        for r in conn.execute(
            "SELECT gm.session_id FROM group_members gm JOIN sessions s ON s.id=gm.session_id "
            "WHERE gm.group_id=? AND s.status != 'purged' ORDER BY gm.session_id",
            (row["id"],),
        )
    ]
    return Group(id=row["id"], name=row["name"], kind=row["kind"], color=row["color"], member_ids=members)
