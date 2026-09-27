"""Configuration: a small TOML file with sensible defaults.

Resolution order: ``APIARY_CONFIG`` env var, then ``~/.config/apiary/apiary.toml``.
A missing file is fine; every key has a default.
"""

from __future__ import annotations

import os
import shlex
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
class Keeper:
    # The command that reads the extract on stdin and prints the summary. Without
    # --no-session-persistence every keeper run would itself become a session.
    summarizer: list[str] = field(
        default_factory=lambda: ["claude", "-p", "--no-session-persistence", "--output-format", "text"]
    )
    summary_timeout_s: float = 240.0
    summary_max_chars: int = 60000


@dataclass(frozen=True)
class Config:
    paths: Paths = field(default_factory=Paths)
    server: Server = field(default_factory=Server)
    keeper: Keeper = field(default_factory=Keeper)
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
        keeper_raw = raw.get("keeper", {})
        paths = Paths(
            claude_dir=_expand(paths_raw.get("claude_dir", Paths().claude_dir)),
            db=_expand(paths_raw.get("db", Paths().db)),
            archive_dir=_expand(paths_raw.get("archive_dir", Paths().archive_dir)),
        )
        server = Server(
            host=str(server_raw.get("host", Server().host)),
            port=int(server_raw.get("port", Server().port)),
        )
        keeper = Keeper(
            summarizer=shlex.split(keeper_raw["summarizer"])
            if "summarizer" in keeper_raw
            else Keeper().summarizer,
            summary_timeout_s=float(keeper_raw.get("summary_timeout_s", Keeper().summary_timeout_s)),
            summary_max_chars=int(keeper_raw.get("summary_max_chars", Keeper().summary_max_chars)),
        )
        return cls(paths=paths, server=server, keeper=keeper, source=candidate)

    def ensure_dirs(self) -> None:
        self.paths.db.parent.mkdir(parents=True, exist_ok=True)
        self.paths.archive_dir.mkdir(parents=True, exist_ok=True)
