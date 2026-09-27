"""The keeper: applies decisions. Archive moves a transcript into ``archive_dir``, honey is the
summary written next to it, purge deletes an archived transcript for good, restore undoes an archive.

Claude Code lists sessions from the files under ``claude_dir``, so archiving is what removes a
session from ``claude --resume``; every file named after the session (relocated copies too)
is moved, and ``sessions.archived_from`` remembers where each came from.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import time
from pathlib import Path

from apiary.config import Config
from apiary.curation import UnknownId
from apiary.db import transaction
from apiary.queries import session_of
from apiary.scoring import score_session


class NotArchived(ValueError):
    """The operation needs an archived session."""


def transcript_files(claude_dir: Path, session_id: str) -> list[Path]:
    """Every ``<session_id>.jsonl`` under ``claude_dir``, the live one (newest) first."""
    if not claude_dir.is_dir():
        return []
    found = [
        p for d in claude_dir.iterdir() if d.is_dir() for p in [d / f"{session_id}.jsonl"] if p.is_file()
    ]
    return sorted(found, key=lambda p: (p.stat().st_mtime, p.stat().st_size), reverse=True)


def archive(conn: sqlite3.Connection, config: Config, session_id: str) -> list[dict]:
    row = _row(conn, session_id)
    if row["status"] == "archived":
        return json.loads(row["archived_from"] or "[]")
    files = transcript_files(config.paths.claude_dir, session_id)
    if not files:
        raise FileNotFoundError(f"no transcript under {config.paths.claude_dir} for {session_id}")
    home = config.paths.archive_dir / row["repo_name"]
    home.mkdir(parents=True, exist_ok=True)
    moves: list[dict] = []
    for i, src in enumerate(files):
        dest = home / (f"{session_id}.jsonl" if i == 0 else f"{session_id}.copy{i}.jsonl")
        shutil.move(str(src), str(dest))
        moves.append({"from": str(src), "to": str(dest)})
    with transaction(conn):
        conn.execute(
            "UPDATE sessions SET status='archived', transcript=?, archived_from=? WHERE id=?",
            (moves[0]["to"], json.dumps(moves), session_id),
        )
        conn.execute("UPDATE gc_decisions SET applied_at=? WHERE session_id=?", (time.time(), session_id))
    return moves


def restore(conn: sqlite3.Connection, session_id: str) -> None:
    row = _row(conn, session_id)
    if row["status"] != "archived":
        raise NotArchived(session_id)
    moves = json.loads(row["archived_from"] or "[]")
    for move in reversed(moves):
        Path(move["from"]).parent.mkdir(parents=True, exist_ok=True)
        shutil.move(move["to"], move["from"])
    canonical = Path(moves[0]["from"])
    st = canonical.stat()
    with transaction(conn):
        conn.execute(
            "UPDATE sessions SET status='idle', transcript=?, archived_from=NULL, mtime=?, size_bytes=? "
            "WHERE id=?",
            (str(canonical), st.st_mtime, st.st_size, session_id),
        )
        conn.execute("DELETE FROM gc_decisions WHERE session_id=?", (session_id,))


def purge(conn: sqlite3.Connection, session_ids: list[str]) -> None:
    """Delete the archived transcripts of ``session_ids``; honey stays. All-or-nothing on the checks."""
    rows = [_row(conn, sid) for sid in session_ids]
    for row in rows:
        if row["status"] != "archived":
            raise NotArchived(row["id"])
    for row in rows:
        for move in json.loads(row["archived_from"] or "[]"):
            Path(move["to"]).unlink(missing_ok=True)
        with transaction(conn):
            conn.execute("UPDATE sessions SET status='purged' WHERE id=?", (row["id"],))


def recompute_scores(conn: sqlite3.Connection, now: float | None = None) -> int:
    now = now or time.time()
    rows = conn.execute("SELECT * FROM sessions WHERE status != 'purged'").fetchall()
    with transaction(conn):
        for row in rows:
            scored = score_session(session_of(row), now)
            conn.execute(
                """INSERT INTO scores(session_id, score, reasons, policy_version, scored_at)
                   VALUES(?, ?, ?, 1, ?)
                   ON CONFLICT(session_id) DO UPDATE SET score=excluded.score, reasons=excluded.reasons,
                       scored_at=excluded.scored_at""",
                (row["id"], scored.score, json.dumps(scored.reasons), now),
            )
    return len(rows)


def _row(conn: sqlite3.Connection, session_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if row is None:
        raise UnknownId(session_id)
    return row
