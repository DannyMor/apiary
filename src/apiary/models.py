"""Pydantic models: the API's vocabulary and the OpenAPI schema."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["live", "idle", "archived", "purged"]


class Session(BaseModel):
    """A session as stored: one row of the ``sessions`` table."""

    id: str
    repo_path: str
    repo_name: str
    branch: str | None = None
    title: str = ""
    created_at: float
    last_active_at: float
    mtime: float
    size_bytes: int = 0
    msg_count: int = 0
    tool_calls: int = 0
    files_edited: int = 0
    parent_id: str | None = None
    status: Status = "idle"
    transcript: str


class Group(BaseModel):
    id: str
    name: str
    kind: Literal["repo", "custom"]
    color: str | None = Field(default=None, description='OKLCH as "l c h"')
    member_ids: list[str] = Field(default_factory=list)


class Health(BaseModel):
    ok: bool = True
    version: str
    db: str
    claude_dir: str
    sessions: int
