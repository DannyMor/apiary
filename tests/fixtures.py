"""Synthetic Claude Code transcripts for tests."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from apiary.config import Config


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def write_transcript(
    claude_dir: Path,
    cwd: str,
    session_id: str,
    first_user: str,
    *,
    start: datetime,
    turns: int = 4,
    edits: int = 0,
    branch: str = "main",
    summary: str | None = None,
    custom_title: str | None = None,
    preamble: str | None = None,
) -> Path:
    """Write a plausible transcript: alternating user/assistant lines with tool_use blocks.

    ``preamble`` is injected as an ``isMeta`` user message before the first turn, the way
    skill preambles appear; ``custom_title`` adds a ``custom-title`` record.
    """
    lines: list[dict] = []
    if summary:
        lines.append({"type": "summary", "summary": summary, "leafUuid": "x"})
    if custom_title:
        lines.append({"type": "custom-title", "customTitle": custom_title, "sessionId": session_id})
    if preamble:
        lines.append(
            {
                "type": "user",
                "isMeta": True,
                "sessionId": session_id,
                "cwd": cwd,
                "gitBranch": branch,
                "timestamp": iso(start),
                "uuid": f"{session_id}-meta",
                "message": {"role": "user", "content": [{"type": "text", "text": preamble}]},
            }
        )
    turn_lines, end = _turns(session_id, cwd, branch, first_user, turns, edits, start)
    return _write(claude_dir, cwd, session_id, lines + turn_lines, end)


def write_fork(
    claude_dir: Path,
    cwd: str,
    chain: list[tuple[str, str, int, int]],
    *,
    start: datetime,
    branch: str = "main",
) -> Path:
    """Write a forked transcript the way Claude Code does: the ancestors' records copied first,
    each carrying its own ``sessionId``, then the fork's own records. ``chain`` is
    ``[(session_id, first_user, turns, edits), ...]`` from the root ancestor to the fork
    itself; the file is named after the last id.
    """
    lines: list[dict] = []
    t = start
    for session_id, first_user, turns, edits in chain:
        seg, t = _turns(session_id, cwd, branch, first_user, turns, edits, t)
        lines += seg
    return _write(claude_dir, cwd, chain[-1][0], lines, t)


def _turns(
    session_id: str, cwd: str, branch: str, first_user: str, turns: int, edits: int, t: datetime
) -> tuple[list[dict], datetime]:
    lines: list[dict] = []
    for i in range(turns):
        role = "user" if i % 2 == 0 else "assistant"
        content: list[dict] = [{"type": "text", "text": first_user if i == 0 else f"turn {i}"}]
        if role == "assistant" and edits > 0:
            content.append(
                {
                    "type": "tool_use",
                    "name": "Edit",
                    "input": {"file_path": f"/src/{session_id}-f{edits}.py", "old_string": "a"},
                }
            )
            edits -= 1
        lines.append(
            {
                "type": role,
                "sessionId": session_id,
                "cwd": cwd,
                "gitBranch": branch,
                "timestamp": iso(t),
                "uuid": f"{session_id}-{i}",
                "message": {"role": role, "content": content},
            }
        )
        t += timedelta(minutes=3)
    return lines, t


def _write(claude_dir: Path, cwd: str, stem: str, lines: list[dict], end: datetime) -> Path:
    project_dir = claude_dir / cwd.replace("/", "-")
    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / f"{stem}.jsonl"
    path.write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    last = (end - timedelta(minutes=3)).timestamp()
    os.utime(path, (last, last))  # Claude writes as it goes: the file is as old as its last line
    return path


def two_sessions(config: Config) -> None:
    """``s1`` in repo ``a`` and ``s2`` in repo ``b``, both idle since yesterday."""
    start = datetime.now(UTC) - timedelta(days=1)
    write_transcript(config.paths.claude_dir, "/u/src/a", "s1", "one", start=start)
    write_transcript(config.paths.claude_dir, "/u/src/b", "s2", "two", start=start)
