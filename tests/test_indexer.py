import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from apiary.db import connect
from apiary.indexer import index_all

from .fixtures import write_fork, write_transcript


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
        claude, "/u/src/hive/.claude/worktrees/review-pr-1", "w1", "Review PR 1", start=datetime.now(UTC)
    )
    conn = connect(tmp_path / "apiary.db")
    index_all(conn, claude)
    row = conn.execute("SELECT repo_path, repo_name, worktree FROM sessions WHERE id='w1'").fetchone()
    assert (row["repo_path"], row["repo_name"], row["worktree"]) == ("/u/src/hive", "hive", "review-pr-1")
    assert [g["id"] for g in conn.execute("SELECT id FROM groups")] == ["repo:hive"]


def test_fork_gets_own_row_with_parent(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    now = datetime.now(UTC)
    write_transcript(
        claude, "/r/repo", "p1", "parent prompt", start=now - timedelta(days=2), turns=6, edits=3
    )
    write_fork(
        claude,
        "/r/repo",
        [("p1", "parent prompt", 6, 3), ("c1", "try another way", 4, 1)],
        start=now - timedelta(days=2),
    )
    conn = connect(tmp_path / "apiary.db")
    index_all(conn, claude)
    rows = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM sessions")}
    assert set(rows) == {"p1", "c1"}
    assert rows["c1"]["parent_id"] == "p1"
    assert rows["p1"]["parent_id"] is None
    assert (rows["c1"]["msg_count"], rows["c1"]["files_edited"]) == (4, 1)
    reasons = conn.execute("SELECT reasons FROM scores WHERE session_id='c1'").fetchone()[0]
    assert "fork with no divergence" in reasons
    r2 = index_all(conn, claude)
    assert (r2.indexed, r2.unchanged) == (0, 2)


def test_relocated_copy_indexes_newest_file_once(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    now = datetime.now(UTC)
    old = write_transcript(claude, "/u/src/a", "r1", "start here", start=now - timedelta(days=2), turns=2)
    conn = connect(tmp_path / "apiary.db")
    index_all(conn, claude)
    assert conn.execute("SELECT msg_count FROM sessions WHERE id='r1'").fetchone()[0] == 2

    new = write_transcript(
        claude, "/u/src/a/.claude/worktrees/w", "r1", "start here", start=now - timedelta(days=1), turns=6
    )
    r = index_all(conn, claude)
    assert (r.scanned, r.indexed, r.superseded, r.purged) == (2, 1, 1, 0)
    row = conn.execute("SELECT msg_count, transcript, status FROM sessions WHERE id='r1'").fetchone()
    assert (row["msg_count"], row["transcript"], row["status"]) == (6, str(new), "idle")
    assert old.exists()

    r3 = index_all(conn, claude)
    assert (r3.indexed, r3.unchanged, r3.superseded) == (0, 1, 1)


def test_index_version_change_reindexes_everything(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    now = datetime.now(UTC)
    write_transcript(claude, "/r/a", "v1", "one", start=now - timedelta(days=1))
    write_transcript(claude, "/r/b", "v2", "two", start=now - timedelta(days=1))
    conn = connect(tmp_path / "apiary.db")
    index_all(conn, claude)
    assert index_all(conn, claude).unchanged == 2

    conn.execute("UPDATE meta SET value='0' WHERE key='index_version'")
    r = index_all(conn, claude)
    assert (r.indexed, r.unchanged) == (2, 0)
    assert index_all(conn, claude).unchanged == 2


def test_reindex_moves_session_between_repo_groups(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    p = write_transcript(claude, "/u/src/a", "m1", "hello", start=datetime.now(UTC) - timedelta(days=1))
    conn = connect(tmp_path / "apiary.db")
    index_all(conn, claude)
    assert [g["id"] for g in conn.execute("SELECT id FROM groups")] == ["repo:a"]

    p.write_text(p.read_text().replace("/u/src/a", "/u/src/b"))
    index_all(conn, claude)
    assert [g["id"] for g in conn.execute("SELECT id FROM groups")] == ["repo:b"]
    assert [
        r["group_id"] for r in conn.execute("SELECT group_id FROM group_members WHERE session_id='m1'")
    ] == ["repo:b"]


def test_repo_group_disappears_when_its_only_session_is_purged(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    p = write_transcript(claude, "/u/src/solo", "g1", "hi", start=datetime.now(UTC) - timedelta(days=1))
    conn = connect(tmp_path / "apiary.db")
    index_all(conn, claude)
    p.unlink()
    index_all(conn, claude)
    assert conn.execute("SELECT status FROM sessions WHERE id='g1'").fetchone()[0] == "purged"
    assert conn.execute("SELECT COUNT(*) FROM groups").fetchone()[0] == 0


def test_report_lists_the_sessions_a_run_changed(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    now = datetime.now(UTC)
    write_transcript(claude, "/r/a", "c1", "one", start=now - timedelta(days=1))
    p2 = write_transcript(claude, "/r/a", "c2", "two", start=now - timedelta(days=1))
    conn = connect(tmp_path / "apiary.db")
    assert sorted(index_all(conn, claude).changed) == ["c1", "c2"]
    assert index_all(conn, claude).changed == []

    p2.write_text(p2.read_text() + '{"type":"user","message":{"role":"user","content":"more"}}\n')
    assert index_all(conn, claude).changed == ["c2"]

    p2.unlink()
    assert index_all(conn, claude).changed == ["c2"]


def test_new_repo_hives_get_distinct_colors(tmp_path: Path) -> None:
    claude = tmp_path / "projects"
    now = datetime.now(UTC)
    write_transcript(claude, "/u/src/a", "a1", "one", start=now - timedelta(days=1))
    write_transcript(claude, "/u/src/b", "b1", "two", start=now - timedelta(days=1))
    conn = connect(tmp_path / "apiary.db")
    index_all(conn, claude)
    colors = {g["id"]: g["color"] for g in conn.execute("SELECT id, color FROM groups")}
    assert colors["repo:a"] == "0.64 0.21 22"
    assert colors["repo:b"] is not None and colors["repo:b"] != colors["repo:a"]
    index_all(conn, claude)
    assert {g["id"]: g["color"] for g in conn.execute("SELECT id, color FROM groups")} == colors
