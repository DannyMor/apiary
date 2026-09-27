import json
from pathlib import Path

from apiary.config import Config
from apiary.openers import ClaudeCliOpener, ClaudeDesktopOpener, Opening


def _registry(tmp_path: Path, mapping: dict[str, str]) -> Path:
    root = tmp_path / "claude-code-sessions" / "org" / "user"
    root.mkdir(parents=True)
    for app_id, transcript_id in mapping.items():
        (root / f"{app_id}.json").write_text(
            json.dumps({"sessionId": app_id, "cliSessionId": transcript_id, "title": "x"})
        )
    return tmp_path / "claude-code-sessions"


def test_desktop_opener_links_a_transcript_to_the_app_session_that_owns_it(tmp_path: Path) -> None:
    registry = _registry(tmp_path, {"local_aaa": "s1", "local_bbb": "s2"})
    (registry / "org" / "user" / "local_broken.json").write_text("{not json")
    opener = ClaudeDesktopOpener(registry, "cliSessionId", "claude://claude.ai/epitaxy/{app_session_id}")
    assert opener.openings("s1") == [
        Opening(label="Open in Claude", url="claude://claude.ai/epitaxy/local_aaa")
    ]
    assert opener.openings("nope") == []

    (registry / "org" / "user" / "local_ccc.json").write_text(json.dumps({"cliSessionId": "s3"}))
    assert opener.openings("s3") == []  # cached until refreshed
    opener.refresh()
    assert opener.openings("s3")[0].url == "claude://claude.ai/epitaxy/local_ccc"


def test_desktop_opener_without_a_registry_offers_nothing(tmp_path: Path) -> None:
    opener = ClaudeDesktopOpener(tmp_path / "missing", "cliSessionId", "claude://x/{app_session_id}")
    assert opener.openings("s1") == []


def test_cli_opener_offers_the_resume_command() -> None:
    assert ClaudeCliOpener().openings("s1") == [
        Opening(label="Resume in terminal", command="claude --resume s1")
    ]


def test_config_reads_desktop_app_section(tmp_path: Path) -> None:
    p = tmp_path / "apiary.toml"
    p.write_text(
        '[desktop_app]\nregistry_dir = "~/x/sessions"\ntranscript_key = "cli"\nlink = "app://{app_session_id}"\n'
    )
    cfg = Config.load(p)
    assert str(cfg.desktop_app.registry_dir).endswith("x/sessions") and "~" not in str(
        cfg.desktop_app.registry_dir
    )
    assert (cfg.desktop_app.transcript_key, cfg.desktop_app.link) == ("cli", "app://{app_session_id}")
    default = Config().desktop_app
    assert default.registry_dir.name == "claude-code-sessions"
    assert default.transcript_key == "cliSessionId"
    assert "{app_session_id}" in default.link
