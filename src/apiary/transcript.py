"""Read one Claude Code transcript (a ``.jsonl`` file) into summary facts.

The format is observed, not specified, so every field is read defensively:
a line that does not parse, or lacks a field, contributes what it can and
nothing else. Only the metadata Apiary needs is kept; message bodies are not stored.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit", "str_replace", "create_file"}
TITLE_MAX = 80


@dataclass
class TranscriptFacts:
    session_id: str | None = None
    cwd: str | None = None
    branch: str | None = None
    title: str = ""
    first_ts: float | None = None
    last_ts: float | None = None
    msg_count: int = 0
    tool_calls: int = 0
    files_edited: set[str] = field(default_factory=set)
    parent_id: str | None = None
    summary: str | None = None
    custom_title: str | None = None


def _ts(value: object) -> float | None:
    if isinstance(value, int | float):
        return float(value) / (1000.0 if value > 1e11 else 1.0)  # ms vs s
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def _text_of(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
                return block["text"]
    return ""


def _clean_title(text: str) -> str:
    text = " ".join(text.split())
    return text[: TITLE_MAX - 1] + "…" if len(text) > TITLE_MAX else text


def read_transcript(path: Path) -> TranscriptFacts:
    """The file is named after its session. A fork starts with the ancestors' records copied
    verbatim, each still carrying the ancestor's ``sessionId``; those only decide ``parent_id``
    (the nearest ancestor) and are not counted as this session's conversation.
    """
    own_id = path.stem
    facts = TranscriptFacts(session_id=own_id)
    saw_own = False
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            try:
                rec = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(rec, dict):
                continue
            sid = rec.get("sessionId") or rec.get("session_id")
            if isinstance(sid, str) and sid != own_id:
                if not saw_own:
                    facts.parent_id = sid
                continue
            saw_own = saw_own or sid == own_id
            _absorb(facts, rec)
    if facts.custom_title:
        facts.title = _clean_title(facts.custom_title)
    elif not facts.title and facts.summary:
        facts.title = _clean_title(facts.summary)
    return facts


def _absorb(f: TranscriptFacts, rec: dict) -> None:
    f.cwd = f.cwd or rec.get("cwd")
    f.branch = f.branch or rec.get("gitBranch") or rec.get("git_branch")
    if rec.get("type") == "summary" and isinstance(rec.get("summary"), str):
        f.summary = rec["summary"]
        return
    if rec.get("type") == "custom-title" and isinstance(rec.get("customTitle"), str):
        f.custom_title = rec["customTitle"]
        return
    ts = _ts(rec.get("timestamp"))
    if ts is not None:
        f.first_ts = ts if f.first_ts is None else min(f.first_ts, ts)
        f.last_ts = ts if f.last_ts is None else max(f.last_ts, ts)

    msg = rec.get("message") if isinstance(rec.get("message"), dict) else None
    role = (msg or {}).get("role") or rec.get("type")
    if role not in ("user", "assistant"):
        return
    if rec.get("isSidechain"):
        return  # sub-agent traffic is not the person's conversation
    f.msg_count += 1
    content = (msg or {}).get("content")
    if role == "user" and not f.title and not rec.get("isMeta"):
        text = _text_of(content)
        if text and not text.startswith("<") and "tool_result" not in text[:40]:
            f.title = _clean_title(text)
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                f.tool_calls += 1
                if block.get("name") in EDIT_TOOLS:
                    inp = block.get("input") or {}
                    fp = inp.get("file_path") or inp.get("path") or inp.get("notebook_path")
                    if isinstance(fp, str):
                        f.files_edited.add(fp)


WORKTREES_SEGMENT = "/.claude/worktrees/"


def split_worktree(cwd: str) -> tuple[str, str | None]:
    """``/repo/.claude/worktrees/<name>/sub`` → ``("/repo", "<name>")``; anything else → ``(cwd, None)``."""
    repo, sep, rest = cwd.partition(WORKTREES_SEGMENT)
    if not sep or not rest:
        return cwd, None
    return repo, rest.split("/", 1)[0]


def repo_name_from_dir(project_dir: Path) -> str:
    """``-Users-me-src-api-server`` → ``api-server`` (last path segment)."""
    return project_dir.name.rstrip("-").split("-")[-1] or project_dir.name


def repo_path_from_dir(project_dir: Path) -> str:
    """Best-effort decode of Claude's directory encoding (``/`` → ``-``)."""
    name = project_dir.name
    return "/" + name.lstrip("-").replace("-", "/") if name.startswith("-") else name
