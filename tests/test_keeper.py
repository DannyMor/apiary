import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from apiary import keeper
from apiary.config import Config
from apiary.db import connect
from apiary.indexer import index_all

from .fixtures import write_transcript


def _indexed(config: Config):
    conn = connect(config.paths.db)
    index_all(conn, config.paths.claude_dir)
    return conn


def test_archive_moves_every_copy_and_the_indexer_leaves_it_alone(config: Config) -> None:
    now = datetime.now(UTC)
    old = write_transcript(
        config.paths.claude_dir, "/u/src/a", "r1", "start", start=now - timedelta(days=40), turns=2
    )
    new = write_transcript(
        config.paths.claude_dir,
        "/u/src/a/.claude/worktrees/w",
        "r1",
        "start",
        start=now - timedelta(days=30),
        turns=6,
    )
    conn = _indexed(config)

    moved = keeper.archive(conn, config, "r1")
    home = config.paths.archive_dir / "a"
    assert [m["to"] for m in moved] == [str(home / "r1.jsonl"), str(home / "r1.copy1.jsonl")]
    assert [m["from"] for m in moved] == [str(new), str(old)]
    assert not new.exists() and not old.exists()
    assert (home / "r1.jsonl").exists() and (home / "r1.copy1.jsonl").exists()

    row = conn.execute("SELECT status, transcript, archived_from FROM sessions WHERE id='r1'").fetchone()
    assert (row["status"], row["transcript"]) == ("archived", str(home / "r1.jsonl"))
    assert json.loads(row["archived_from"]) == moved

    r = index_all(conn, config.paths.claude_dir)
    assert (r.scanned, r.indexed, r.purged) == (0, 0, 0)
    assert conn.execute("SELECT status FROM sessions WHERE id='r1'").fetchone()[0] == "archived"


def test_restore_puts_the_files_back_and_clears_the_decision(config: Config) -> None:
    p = write_transcript(
        config.paths.claude_dir, "/u/src/a", "s1", "hello", start=datetime.now(UTC) - timedelta(days=30)
    )
    conn = _indexed(config)
    conn.execute(
        "INSERT INTO gc_decisions(session_id, decision, decided_at) VALUES('s1', 'archive', ?)",
        (time.time(),),
    )
    keeper.archive(conn, config, "s1")
    assert not p.exists()

    keeper.restore(conn, "s1")
    assert p.exists()
    row = conn.execute("SELECT status, transcript, archived_from FROM sessions WHERE id='s1'").fetchone()
    assert (row["status"], row["transcript"], row["archived_from"]) == ("idle", str(p), None)
    assert conn.execute("SELECT COUNT(*) FROM gc_decisions WHERE session_id='s1'").fetchone()[0] == 0
    assert index_all(conn, config.paths.claude_dir).unchanged == 1


def test_purge_deletes_archived_transcripts_but_keeps_honey(config: Config) -> None:
    write_transcript(
        config.paths.claude_dir, "/u/src/a", "s1", "hello", start=datetime.now(UTC) - timedelta(days=30)
    )
    write_transcript(
        config.paths.claude_dir, "/u/src/a", "s2", "still here", start=datetime.now(UTC) - timedelta(days=30)
    )
    conn = _indexed(config)
    keeper.archive(conn, config, "s1")
    honey = config.paths.archive_dir / "a" / "s1.md"
    honey.write_text("# honey\n")

    with pytest.raises(keeper.NotArchived):
        keeper.purge(conn, ["s2"])
    keeper.purge(conn, ["s1"])
    assert not (config.paths.archive_dir / "a" / "s1.jsonl").exists()
    assert honey.exists()
    assert conn.execute("SELECT status FROM sessions WHERE id='s1'").fetchone()[0] == "purged"


def test_recompute_scores_uses_the_current_time(config: Config) -> None:
    write_transcript(
        config.paths.claude_dir,
        "/u/src/a",
        "s1",
        "Refactor auth",
        start=datetime.now(UTC) - timedelta(days=1),
        edits=3,
    )
    conn = _indexed(config)
    before = conn.execute("SELECT score FROM scores WHERE session_id='s1'").fetchone()[0]
    assert keeper.recompute_scores(conn, now=time.time() + 60 * 86400) == 1
    after = conn.execute("SELECT score FROM scores WHERE session_id='s1'").fetchone()[0]
    assert after < before


def test_config_reads_keeper_section(tmp_path: Path) -> None:
    p = tmp_path / "apiary.toml"
    p.write_text(
        '[keeper]\nsummarizer = "claude -p --model sonnet"\n'
        "summary_timeout_s = 30\nsummary_max_chars = 1000\n"
    )
    cfg = Config.load(p)
    assert cfg.keeper.summarizer == ["claude", "-p", "--model", "sonnet"]
    assert (cfg.keeper.summary_timeout_s, cfg.keeper.summary_max_chars) == (30.0, 1000)
    assert Config().keeper.summarizer == [
        "claude",
        "-p",
        "--no-session-persistence",
        "--output-format",
        "text",
    ]
