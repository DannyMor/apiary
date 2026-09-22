"""Synthetic Claude Code transcripts for tests."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path


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
) -> Path:
    """Write a plausible transcript: alternating user/assistant lines with tool_use blocks."""
    project_dir = claude_dir / cwd.replace("/", "-")
    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / f"{session_id}.jsonl"
    lines: list[dict] = []
    if summary:
        lines.append({"type": "summary", "summary": summary, "leafUuid": "x"})
    t = start
    for i in range(turns):
        role = "user" if i % 2 == 0 else "assistant"
        content: list[dict] = [{"type": "text", "text": first_user if i == 0 else f"turn {i}"}]
        if role == "assistant" and edits > 0:
            content.append(
                {
                    "type": "tool_use",
                    "name": "Edit",
                    "input": {"file_path": f"/src/f{edits}.py", "old_string": "a"},
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
    path.write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    last = (t - timedelta(minutes=3)).timestamp()
    os.utime(path, (last, last))  # Claude writes as it goes: the file is as old as its last line
    return path
