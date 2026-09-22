from pathlib import Path

import pytest

from apiary.config import Config, Paths, Server


@pytest.fixture
def config(tmp_path: Path) -> Config:
    claude = tmp_path / "claude" / "projects"
    claude.mkdir(parents=True)
    return Config(
        paths=Paths(claude_dir=claude, db=tmp_path / "apiary.db", archive_dir=tmp_path / "archive"),
        server=Server(),
    )
