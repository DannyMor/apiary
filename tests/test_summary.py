from datetime import UTC, datetime, timedelta

from apiary import keeper
from apiary.config import Config
from apiary.db import connect
from apiary.indexer import index_all

from .fixtures import write_fork, write_transcript


def test_extract_keeps_the_conversation_and_drops_copied_history_and_meta(tmp_path) -> None:
    start = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    p = write_fork(
        tmp_path, "/r/repo", [("parent", "parent prompt", 2, 1), ("child", "child prompt", 4, 2)], start=start
    )
    text = keeper.extract(p, max_chars=10_000)
    assert "child prompt" in text and "parent prompt" not in text
    assert "Edit /src/child-f2.py" in text  # tool calls appear as one line each, without their inputs
    assert "old_string" not in text

    q = write_transcript(
        tmp_path, "/r/repo", "m1", "real question", start=start, preamble="Base directory for this skill"
    )
    meta = keeper.extract(q, max_chars=10_000)
    assert "real question" in meta and "Base directory" not in meta


def test_extract_is_capped(tmp_path) -> None:
    p = write_transcript(tmp_path, "/r/repo", "big", "x" * 400, start=datetime.now(UTC), turns=40)
    text = keeper.extract(p, max_chars=600)
    assert len(text) <= 600 and text.endswith("…")


def test_summarize_writes_honey_with_front_matter(config: Config) -> None:
    write_transcript(
        config.paths.claude_dir,
        "/u/src/a",
        "s1",
        "hello keeper",
        start=datetime.now(UTC) - timedelta(days=30),
    )
    conn = connect(config.paths.db)
    index_all(conn, config.paths.claude_dir)
    seen = {}

    def fake(prompt: str, extract: str) -> str:
        seen["prompt"], seen["extract"] = prompt, extract
        return "Talked about the keeper."

    path = keeper.summarize(conn, config, "s1", fake)
    assert path == config.paths.archive_dir / "a" / "s1.md"
    text = path.read_text()
    assert text.startswith("---\ntitle: hello keeper\nsession: s1\nrepo: a\n")
    assert text.rstrip().endswith("Talked about the keeper.")
    assert "hello keeper" in seen["extract"] and "Markdown" in seen["prompt"]
    assert conn.execute("SELECT honey FROM sessions WHERE id='s1'").fetchone()[0] == str(path)


def test_claude_cli_pipes_the_extract_and_returns_stdout() -> None:
    cli = keeper.ClaudeCli(
        ["python3", "-c", "import sys; print('SUM:' + sys.stdin.read()[:5] + '|' + sys.argv[1])"], 10
    )
    assert cli("the prompt", "extract text") == "SUM:extra|the prompt"
