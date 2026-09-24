"""Pydantic models: the API's vocabulary and the OpenAPI schema."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Status = Literal["live", "idle", "archived", "purged"]
Decision = Literal["keep", "archive", "summarize_archive"]


class Session(BaseModel):
    """A session as stored: one row of the ``sessions`` table.

    ``id`` is the transcript's file stem, the session id Claude Code named the file by.
    ``parent_id`` is the session this one was forked from.
    """

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
    worktree: str | None = None


class SessionOut(Session):
    """A session as served: the row plus what the UI needs alongside it."""

    score: int = 0
    reasons: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    groups: list[str] = Field(default_factory=list)
    decision: Decision | None = None


class Group(BaseModel):
    id: str
    name: str
    kind: Literal["repo", "custom"]
    color: str | None = Field(default=None, description='OKLCH as "l c h"')
    member_ids: list[str] = Field(default_factory=list)


class SwarmIn(BaseModel):
    name: str = Field(min_length=1)
    color: str | None = Field(default=None, description='OKLCH as "l c h"; suggested when omitted')
    member_ids: list[str] = Field(default_factory=list)


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    color: str | None = None


class MembersIn(BaseModel):
    session_ids: list[str] = Field(min_length=1)


class TagIn(BaseModel):
    tag: str = Field(min_length=1)

    @field_validator("tag", mode="before")
    @classmethod
    def _strip(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class TagCount(BaseModel):
    tag: str
    count: int


class DecisionIn(BaseModel):
    session_id: str
    decision: Decision


class Health(BaseModel):
    ok: bool = True
    version: str
    db: str
    claude_dir: str
    sessions: int
