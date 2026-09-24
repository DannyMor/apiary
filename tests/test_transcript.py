from datetime import UTC, datetime, timedelta
from pathlib import Path

from apiary.transcript import read_transcript, repo_name_from_dir, repo_path_from_dir, split_worktree

from .fixtures import write_fork, write_transcript


def test_reads_facts(tmp_path: Path) -> None:
    start = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    p = write_transcript(
        tmp_path, "/Users/me/src/api-server", "abc", "Refactor auth middleware", start=start, turns=6, edits=2
    )
    f = read_transcript(p)
    assert f.session_id == "abc"
    assert f.cwd == "/Users/me/src/api-server"
    assert f.branch == "main"
    assert f.title == "Refactor auth middleware"
    assert f.msg_count == 6
    assert f.tool_calls == 2
    assert f.files_edited == {"/src/abc-f2.py", "/src/abc-f1.py"}
    assert f.first_ts == start.timestamp()
    assert f.last_ts == start.timestamp() + 5 * 180


def test_summary_becomes_title_when_no_user_text(tmp_path: Path) -> None:
    p = tmp_path / "x.jsonl"
    p.write_text(
        '{"type":"summary","summary":"Investigated OOM in worker"}\n'
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]},'
        '"timestamp":"2026-09-01T10:00:00Z"}\n'
    )
    assert read_transcript(p).title == "Investigated OOM in worker"


def test_tolerates_garbage(tmp_path: Path) -> None:
    p = tmp_path / "x.jsonl"
    p.write_text('not json\n{"type":"user","message":{"role":"user","content":"hello"}}\n[1,2]\n')
    f = read_transcript(p)
    assert f.msg_count == 1
    assert f.title == "hello"


def test_dir_decoding() -> None:
    d = Path("/x/-Users-me-src-api-server")
    assert repo_name_from_dir(d) == "server"  # segments are ambiguous; cwd inside the file is preferred
    assert repo_path_from_dir(d) == "/Users/me/src/api/server"


def test_split_worktree() -> None:
    assert split_worktree("/u/src/orca/.claude/worktrees/review-pr-1/services/x") == (
        "/u/src/orca",
        "review-pr-1",
    )
    assert split_worktree("/u/src/orca") == ("/u/src/orca", None)


def test_custom_title_wins_over_first_prompt(tmp_path: Path) -> None:
    start = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    p = write_transcript(
        tmp_path, "/r/repo", "t1", "please look at this story", start=start, custom_title="Alert lifecycle"
    )
    assert read_transcript(p).title == "Alert lifecycle"


def test_meta_user_messages_are_not_titles(tmp_path: Path) -> None:
    start = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    p = write_transcript(
        tmp_path,
        "/r/repo",
        "t2",
        "Review the auth PR",
        start=start,
        preamble="Base directory for this skill: /x/review",
    )
    assert read_transcript(p).title == "Review the auth PR"


def test_fork_file_counts_only_its_own_records(tmp_path: Path) -> None:
    start = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    p = write_fork(
        tmp_path, "/r/repo", [("parent", "parent prompt", 2, 1), ("child", "child prompt", 4, 2)], start=start
    )
    f = read_transcript(p)
    assert f.parent_id == "parent"
    assert f.title == "child prompt"
    assert f.msg_count == 4
    assert f.files_edited == {"/src/child-f2.py", "/src/child-f1.py"}
    assert f.first_ts == (start + timedelta(minutes=6)).timestamp()


def test_fork_of_fork_parent_is_nearest(tmp_path: Path) -> None:
    start = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    p = write_fork(tmp_path, "/r/repo", [("a", "a", 2, 0), ("b", "b", 2, 0), ("c", "c", 2, 0)], start=start)
    assert read_transcript(p).parent_id == "b"
