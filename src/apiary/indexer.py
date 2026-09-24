"""Index Claude Code transcripts into SQLite.

``index_all`` walks ``claude_dir``, stats every ``*.jsonl``, keeps one file per session
(the newest, when a relocated session left a frozen copy behind), and re-reads only the
files whose path, mtime or size changed since they were last indexed. Sessions whose
transcript disappeared are marked ``purged``. Repo groups are created for every repo
seen. Scores are recomputed for anything touched.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path

from apiary.db import transaction
from apiary.models import Session
from apiary.scoring import score_session
from apiary.transcript import read_transcript, repo_name_from_dir, repo_path_from_dir, split_worktree

LIVE_WINDOW_SECONDS = 120.0  # a transcript written this recently counts as running
# Bump whenever transcript parsing or row derivation changes: every file is re-read once.
INDEX_VERSION = 2


@dataclass
class IndexReport:
    scanned: int = 0
    indexed: int = 0
    unchanged: int = 0
    superseded: int = 0
    purged: int = 0
    duration_s: float = 0.0
    changed: list[str] = field(default_factory=list)  # session ids indexed or purged by this run


def index_all(conn: sqlite3.Connection, claude_dir: Path, now: float | None = None) -> IndexReport:
    now = now or time.time()
    t0 = time.perf_counter()
    report = IndexReport()
    known = {
        row["id"]: (row["transcript"], row["mtime"], row["size_bytes"])
        for row in conn.execute(
            "SELECT id, transcript, mtime, size_bytes FROM sessions WHERE status != 'purged'"
        )
    }
    seen: set[str] = set()
    reread_all = not _index_version_current(conn)

    for session_id, (project_dir, path, st) in _canonical_transcripts(claude_dir, report).items():
        seen.add(session_id)
        if not reread_all and known.get(session_id) == (str(path), st.st_mtime, st.st_size):
            report.unchanged += 1
            _refresh_liveness(conn, session_id, st.st_mtime, now)
            continue
        _index_one(conn, project_dir, path, st.st_mtime, st.st_size, now)
        report.indexed += 1
        report.changed.append(session_id)

    gone = [k for k in known if k not in seen]
    if gone:
        with transaction(conn):
            for k in gone:
                conn.execute("UPDATE sessions SET status='purged' WHERE id=?", (k,))
        report.purged = len(gone)
        report.changed.extend(gone)
    conn.execute(
        """DELETE FROM groups WHERE kind='repo' AND id NOT IN (
               SELECT gm.group_id FROM group_members gm JOIN sessions s ON s.id=gm.session_id
               WHERE s.status != 'purged')"""
    )

    report.duration_s = time.perf_counter() - t0
    return report


def _index_version_current(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT value FROM meta WHERE key='index_version'").fetchone()
    if row and int(row["value"]) == INDEX_VERSION:
        return True
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('index_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(INDEX_VERSION),),
    )
    return False


def _canonical_transcripts(
    claude_dir: Path, report: IndexReport
) -> dict[str, tuple[Path, Path, os.stat_result]]:
    """One ``(project_dir, path, stat)`` per session id (the file stem).

    When a session relocates to another cwd, Claude Code copies the transcript into the new
    project dir under the same name and keeps writing there; the old file stays frozen. The
    most recently written file is therefore the session.
    """
    best: dict[str, tuple[Path, Path, os.stat_result]] = {}
    if not claude_dir.is_dir():
        return best
    for project_dir in sorted(p for p in claude_dir.iterdir() if p.is_dir()):
        for path in sorted(project_dir.glob("*.jsonl")):
            report.scanned += 1
            st = path.stat()
            current = best.get(path.stem)
            if current is not None:
                report.superseded += 1
                if (st.st_mtime, st.st_size) <= (current[2].st_mtime, current[2].st_size):
                    continue
            best[path.stem] = (project_dir, path, st)
    return best


def _refresh_liveness(conn: sqlite3.Connection, session_id: str, mtime: float, now: float) -> None:
    status = "live" if now - mtime < LIVE_WINDOW_SECONDS else "idle"
    conn.execute(
        "UPDATE sessions SET status=? WHERE id=? AND status IN ('live','idle') AND status != ?",
        (status, session_id, status),
    )


def _index_one(
    conn: sqlite3.Connection, project_dir: Path, path: Path, mtime: float, size: int, now: float
) -> None:
    facts = read_transcript(path)
    session_id = path.stem
    repo_path, worktree = split_worktree(facts.cwd) if facts.cwd else (repo_path_from_dir(project_dir), None)
    repo_name = Path(repo_path).name or repo_name_from_dir(project_dir)
    last = facts.last_ts or mtime
    created = facts.first_ts or last
    status = "live" if now - mtime < LIVE_WINDOW_SECONDS else "idle"
    session = Session(
        id=session_id,
        repo_path=repo_path,
        repo_name=repo_name,
        branch=facts.branch,
        title=facts.title or path.stem[:8],
        created_at=created,
        last_active_at=last,
        mtime=mtime,
        size_bytes=size,
        msg_count=facts.msg_count,
        tool_calls=facts.tool_calls,
        files_edited=len(facts.files_edited),
        parent_id=facts.parent_id,
        status=status,
        transcript=str(path),
        worktree=worktree,
    )
    scored = score_session(session, now)
    group_id = f"repo:{repo_name}"
    with transaction(conn):
        conn.execute(
            """INSERT INTO sessions(id, repo_path, repo_name, branch, title, created_at, last_active_at,
                   mtime, size_bytes, msg_count, tool_calls, files_edited, parent_id, status, transcript,
                   worktree)
               VALUES(:id, :repo_path, :repo_name, :branch, :title, :created_at, :last_active_at,
                   :mtime, :size_bytes, :msg_count, :tool_calls, :files_edited, :parent_id, :status,
                   :transcript, :worktree)
               ON CONFLICT(id) DO UPDATE SET
                   repo_path=excluded.repo_path, repo_name=excluded.repo_name, branch=excluded.branch,
                   title=excluded.title, created_at=excluded.created_at,
                   last_active_at=excluded.last_active_at,
                   mtime=excluded.mtime, size_bytes=excluded.size_bytes, msg_count=excluded.msg_count,
                   tool_calls=excluded.tool_calls, files_edited=excluded.files_edited,
                   parent_id=excluded.parent_id, transcript=excluded.transcript,
                   worktree=excluded.worktree,
                   status=CASE WHEN sessions.status='archived' THEN 'archived' ELSE excluded.status END""",
            session.model_dump(),
        )
        conn.execute(
            "INSERT INTO groups(id, name, kind) VALUES(?, ?, 'repo') ON CONFLICT(id) DO NOTHING",
            (group_id, repo_name),
        )
        conn.execute(
            "DELETE FROM group_members WHERE session_id=? AND group_id != ? "
            "AND group_id IN (SELECT id FROM groups WHERE kind='repo')",
            (session_id, group_id),
        )
        conn.execute(
            "INSERT INTO group_members(group_id, session_id) VALUES(?, ?) ON CONFLICT DO NOTHING",
            (group_id, session_id),
        )
        conn.execute(
            """INSERT INTO scores(session_id, score, reasons, policy_version, scored_at)
               VALUES(?, ?, ?, 1, ?)
               ON CONFLICT(session_id) DO UPDATE SET score=excluded.score, reasons=excluded.reasons,
                   scored_at=excluded.scored_at""",
            (session_id, scored.score, json.dumps(scored.reasons), now),
        )
