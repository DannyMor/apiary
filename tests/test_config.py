from pathlib import Path

from apiary.config import Config


def test_defaults_when_missing(tmp_path: Path) -> None:
    cfg = Config.load(tmp_path / "nope.toml")
    assert cfg.source is None
    assert cfg.server.port == 7431


def test_reads_toml(tmp_path: Path) -> None:
    p = tmp_path / "apiary.toml"
    p.write_text('[paths]\ndb = "~/x/apiary.db"\n[server]\nport = 9000\n')
    cfg = Config.load(p)
    assert cfg.source == p
    assert cfg.server.port == 9000
    assert str(cfg.paths.db).endswith("x/apiary.db")
    assert "~" not in str(cfg.paths.db)
