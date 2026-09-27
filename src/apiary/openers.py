"""Ways to open a session outside Apiary.

An ``Opener`` turns a session id into ``Opening`` values the UI renders generically: a
``url`` to navigate to or a ``command`` to copy. The Claude desktop app is one opener; the
CLI's ``--resume`` is another. Add a class here to offer a new place, nothing else changes.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

from apiary.models import Opening

__all__ = ["ClaudeCliOpener", "ClaudeDesktopOpener", "Opener", "Opening", "openings_for"]


class Opener(Protocol):
    def refresh(self) -> None: ...
    def openings(self, session_id: str) -> list[Opening]: ...


class ClaudeDesktopOpener:
    """The desktop app keeps one JSON per session under ``registry_dir``, named by its own id and
    carrying the transcript's id under ``transcript_key``; ``link`` opens that app session."""

    def __init__(self, registry_dir: Path, transcript_key: str, link: str) -> None:
        self.registry_dir = registry_dir
        self.transcript_key = transcript_key
        self.link = link
        self._app_id_by_transcript: dict[str, str] = {}
        self.refresh()

    def refresh(self) -> None:
        found: dict[str, str] = {}
        if self.registry_dir.is_dir():
            for path in self.registry_dir.glob("*/*/*.json"):
                try:
                    record = json.loads(path.read_text())
                except (OSError, ValueError):
                    continue
                transcript_id = record.get(self.transcript_key) if isinstance(record, dict) else None
                if isinstance(transcript_id, str):
                    found[transcript_id] = path.stem
        self._app_id_by_transcript = found

    def openings(self, session_id: str) -> list[Opening]:
        app_id = self._app_id_by_transcript.get(session_id)
        return (
            [Opening(label="Open in Claude", url=self.link.format(app_session_id=app_id))] if app_id else []
        )


class ClaudeCliOpener:
    def refresh(self) -> None:
        return None

    def openings(self, session_id: str) -> list[Opening]:
        return [Opening(label="Resume in terminal", command=f"claude --resume {session_id}")]


def openings_for(openers: list[Opener], session_id: str) -> list[Opening]:
    return [o for opener in openers for o in opener.openings(session_id)]
