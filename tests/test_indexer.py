import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from apiary.db import connect
from apiary.indexer import index_all

from .fixtures import write_transcript


def test_index_round_trip(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    now = datetime.now(UTC)
    write_transcript(
        claude,
        "/Users/me/src/api-server",
        "s1",
        "Refactor auth middleware",
        start=now - timedelta(days=1),
        turns=8,
        edits=3,
    )
    write_transcript(
        claude, "/Users/me/src/api-server", "s2", "Review PR #1403", start=now - timedelta(days=20), turns=4
    )
    write_transcript(
        claude, "/Users/me/src/web-app", "s3", "Fix typo in README", start=now - timedelta(days=60), turns=2
    )
    conn = connect(tmp_path / "apiary.db")

    r = index_all(conn, claude)
    assert (r.scanned, r.indexed, r.unchanged, r.purged) == (3, 3, 0, 0)

    rows = {row["id"]: dict(row) for row in conn.execute("SELECT * FROM sessions")}
    assert rows["s1"]["repo_name"] == "api-server"
    assert rows["s1"]["files_edited"] == 3
    assert rows["s1"]["msg_count"] == 8
    assert rows["s3"]["repo_name"] == "web-app"
    groups = {g["id"] for g in conn.execute("SELECT id FROM groups")}
    assert groups == {"repo:api-server", "repo:web-app"}

    scores = {s["session_id"]: s["score"] for s in conn.execute("SELECT * FROM scores")}
    assert scores["s1"] > scores["s2"] > scores["s3"]

    # second pass: nothing changed
    r2 = index_all(conn, claude)
    assert (r2.indexed, r2.unchanged) == (0, 3)

    # a transcript grows: re-indexed
    p = claude / "-Users-me-src-api-server" / "s2.jsonl"
    p.write_text(
        p.read_text()
        + '{"type":"user","message":{"role":"user","content":"more"},"timestamp":"2026-09-22T10:00:00Z"}\n'
    )
    r3 = index_all(conn, claude)
    assert r3.indexed == 1
    assert conn.execute("SELECT msg_count FROM sessions WHERE id='s2'").fetchone()[0] == 5

    # a transcript vanishes: purged, not deleted
    p.unlink()
    r4 = index_all(conn, claude)
    assert r4.purged == 1
    assert conn.execute("SELECT status FROM sessions WHERE id='s2'").fetchone()[0] == "purged"


def test_live_status_by_mtime(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    p = write_transcript(claude, "/r/repo", "live1", "Doing things", start=datetime.now(UTC))
    conn = connect(tmp_path / "apiary.db")
    index_all(conn, claude, now=time.time())
    assert conn.execute("SELECT status FROM sessions WHERE id='live1'").fetchone()[0] == "live"
    index_all(conn, claude, now=p.stat().st_mtime + 3600)
    assert conn.execute("SELECT status FROM sessions WHERE id='live1'").fetchone()[0] == "idle"


def test_worktree_session_belongs_to_parent_repo(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    write_transcript(
        claude, "/u/src/orca/.claude/worktrees/review-pr-1", "w1", "Review PR 1", start=datetime.now(UTC)
    )
    conn = connect(tmp_path / "apiary.db")
    index_all(conn, claude)
    row = conn.execute("SELECT repo_path, repo_name, worktree FROM sessions WHERE id='w1'").fetchone()
    assert (row["repo_path"], row["repo_name"], row["worktree"]) == ("/u/src/orca", "orca", "review-pr-1")
    assert [g["id"] for g in conn.execute("SELECT id FROM groups")] == ["repo:orca"]
