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
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from apiary.config import Config
from apiary.curation import UnknownId
from apiary.db import transaction
from apiary.queries import session_of
from apiary.scoring import score_session
from apiary.transcript import own_records

SUMMARY_PROMPT = (
    "Summarize this Claude Code session as Markdown for someone deciding later whether it mattered: "
    "a one-line goal, what was done, files touched, the outcome, and open threads. "
    "At most 250 words. No preamble."
)
BLOCK_MAX_CHARS = 1500


class Summarizer(Protocol):
    def __call__(self, prompt: str, extract: str) -> str: ...


class ClaudeCli:
    """Runs ``<command> <prompt>`` with the extract on stdin and returns stdout; ``claude -p`` by default."""

    def __init__(self, command: list[str], timeout_s: float) -> None:
        self.command = command
        self.timeout_s = timeout_s

    def __call__(self, prompt: str, extract: str) -> str:
        done = subprocess.run(
            [*self.command, prompt], input=extract, capture_output=True, text=True, timeout=self.timeout_s
        )
        if done.returncode != 0:
            raise RuntimeError(f"{self.command[0]} exited {done.returncode}: {done.stderr.strip()[:500]}")
        return done.stdout.strip()


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


def extract(path: Path, max_chars: int) -> str:
    """The conversation as text: prompts, replies and one line per tool call, capped at ``max_chars``."""
    lines: list[str] = []
    for rec in own_records(path):
        msg = rec.get("message") if isinstance(rec.get("message"), dict) else None
        role = (msg or {}).get("role") or rec.get("type")
        if role not in ("user", "assistant") or rec.get("isSidechain") or rec.get("isMeta"):
            continue
        content = (msg or {}).get("content")
        if isinstance(content, str):
            lines.append(f"{role}: {content[:BLOCK_MAX_CHARS]}")
        elif isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                if (
                    block.get("type") == "text"
                    and isinstance(block.get("text"), str)
                    and block["text"].strip()
                ):
                    lines.append(f"{role}: {block['text'][:BLOCK_MAX_CHARS]}")
                elif block.get("type") == "tool_use":
                    inp = block.get("input") if isinstance(block.get("input"), dict) else {}
                    target = next(
                        (
                            inp[k]
                            for k in ("file_path", "path", "notebook_path", "command", "pattern")
                            if k in inp
                        ),
                        "",
                    )
                    lines.append(f"tool: {block.get('name', '?')} {str(target)[:200]}".rstrip())
    text = "\n".join(lines)
    return text if len(text) <= max_chars else text[: max_chars - 1] + "…"


def summarize(conn: sqlite3.Connection, config: Config, session_id: str, summarizer: Summarizer) -> Path:
    """Write the honey for a session next to where its archive lives (or would live) and remember the path."""
    prompt, text = summary_input(conn, config, session_id)
    return write_honey(conn, config, session_id, summarizer(prompt, text))


def summary_input(conn: sqlite3.Connection, config: Config, session_id: str) -> tuple[str, str]:
    """The prompt and the session's extract. Reads only, so the summarizer can run on another thread."""
    row = _row(conn, session_id)
    transcript = Path(row["transcript"])
    if not transcript.is_file():
        raise FileNotFoundError(f"transcript missing for {session_id}: {transcript}")
    return SUMMARY_PROMPT, extract(transcript, config.keeper.summary_max_chars)


def write_honey(conn: sqlite3.Connection, config: Config, session_id: str, body: str) -> Path:
    row = _row(conn, session_id)
    home = config.paths.archive_dir / row["repo_name"]
    home.mkdir(parents=True, exist_ok=True)
    path = home / f"{session_id}.md"
    front = [
        f"title: {row['title']}",
        f"session: {session_id}",
        f"repo: {row['repo_name']}",
        *([f"branch: {row['branch']}"] if row["branch"] else []),
        *([f"worktree: {row['worktree']}"] if row["worktree"] else []),
        f"created: {_day(row['created_at'])}",
        f"last_active: {_day(row['last_active_at'])}",
        f"messages: {row['msg_count']}",
        f"tool_calls: {row['tool_calls']}",
        f"files_edited: {row['files_edited']}",
        *([f"forked_from: {row['parent_id']}"] if row["parent_id"] else []),
        f"summarized: {datetime.now(UTC).isoformat(timespec='seconds')}",
    ]
    path.write_text("---\n" + "\n".join(front) + "\n---\n\n" + body.strip() + "\n")
    with transaction(conn):
        conn.execute("UPDATE sessions SET honey=? WHERE id=?", (str(path), session_id))
        conn.execute("UPDATE gc_decisions SET summary_path=? WHERE session_id=?", (str(path), session_id))
    return path


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


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).date().isoformat()


def _row(conn: sqlite3.Connection, session_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if row is None:
        raise UnknownId(session_id)
    return row
