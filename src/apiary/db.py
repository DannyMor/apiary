"""SQLite access: one connection per call site, WAL mode, schema versioning.

The schema is applied idempotently on open. Later stages add tables by bumping
``SCHEMA_VERSION`` and appending a migration step.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    repo_path      TEXT NOT NULL,
    repo_name      TEXT NOT NULL,
    branch         TEXT,
    title          TEXT NOT NULL DEFAULT '',
    created_at     REAL NOT NULL,          -- unix seconds
    last_active_at REAL NOT NULL,
    mtime          REAL NOT NULL,          -- transcript file mtime at index time
    size_bytes     INTEGER NOT NULL DEFAULT 0,
    msg_count      INTEGER NOT NULL DEFAULT 0,
    tool_calls     INTEGER NOT NULL DEFAULT 0,
    files_edited   INTEGER NOT NULL DEFAULT 0,
    parent_id      TEXT,
    status         TEXT NOT NULL DEFAULT 'idle',   -- live | idle | archived | purged
    transcript     TEXT NOT NULL            -- absolute path of the .jsonl
);
CREATE INDEX IF NOT EXISTS idx_sessions_repo_active ON sessions(repo_name, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_mtime       ON sessions(mtime);
CREATE INDEX IF NOT EXISTS idx_sessions_parent      ON sessions(parent_id);

CREATE TABLE IF NOT EXISTS groups (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    kind  TEXT NOT NULL CHECK (kind IN ('repo', 'custom')),
    color TEXT                              -- oklch as "l c h"
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, session_id)
);

CREATE TABLE IF NOT EXISTS tags (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tag        TEXT NOT NULL,
    PRIMARY KEY (session_id, tag)
);

CREATE TABLE IF NOT EXISTS scores (
    session_id     TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    score          INTEGER NOT NULL,
    reasons        TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
    policy_version INTEGER NOT NULL DEFAULT 1,
    scored_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score);

CREATE TABLE IF NOT EXISTS gc_decisions (
    session_id   TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    decision     TEXT NOT NULL CHECK (decision IN ('keep', 'archive', 'summarize_archive')),
    decided_at   REAL NOT NULL,
    applied_at   REAL,
    summary_path TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    # autocommit; transactions are explicit. The app touches the connection only from the
    # event loop thread (async endpoints), so cross-thread checks are relaxed for startup.
    conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    _migrate(conn)
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    current = int(row["value"]) if row else 0
    if current < SCHEMA_VERSION:
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(SCHEMA_VERSION),),
        )


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    conn.execute("BEGIN")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
