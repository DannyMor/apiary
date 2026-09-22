"""Configuration: a small TOML file with sensible defaults.

Resolution order: ``APIARY_CONFIG`` env var, then ``~/.config/apiary/apiary.toml``.
A missing file is fine; every key has a default.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CONFIG_PATH = Path("~/.config/apiary/apiary.toml")


def _expand(p: str | Path) -> Path:
    return Path(os.path.expandvars(str(p))).expanduser()


@dataclass(frozen=True)
class Paths:
    claude_dir: Path = field(default_factory=lambda: _expand("~/.claude/projects"))
    db: Path = field(default_factory=lambda: _expand("~/.local/share/apiary/apiary.db"))
    archive_dir: Path = field(default_factory=lambda: _expand("~/.local/share/apiary/archive"))


@dataclass(frozen=True)
class Server:
    host: str = "127.0.0.1"
    port: int = 7431


@dataclass(frozen=True)
class Config:
    paths: Paths = field(default_factory=Paths)
    server: Server = field(default_factory=Server)
    source: Path | None = None  # where this config was read from, if anywhere

    @classmethod
    def load(cls, path: Path | None = None) -> Config:
        if path is None:
            env = os.environ.get("APIARY_CONFIG")
            path = _expand(env) if env else _expand(DEFAULT_CONFIG_PATH)
        candidate = path
        if not candidate.exists():
            return cls()
        with candidate.open("rb") as fh:
            raw = tomllib.load(fh)
        paths_raw = raw.get("paths", {})
        server_raw = raw.get("server", {})
        paths = Paths(
            claude_dir=_expand(paths_raw.get("claude_dir", Paths().claude_dir)),
            db=_expand(paths_raw.get("db", Paths().db)),
            archive_dir=_expand(paths_raw.get("archive_dir", Paths().archive_dir)),
        )
        server = Server(
            host=str(server_raw.get("host", Server().host)),
            port=int(server_raw.get("port", Server().port)),
        )
        return cls(paths=paths, server=server, source=candidate)

    def ensure_dirs(self) -> None:
        self.paths.db.parent.mkdir(parents=True, exist_ok=True)
        self.paths.archive_dir.mkdir(parents=True, exist_ok=True)
