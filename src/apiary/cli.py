"""Command line: ``apiary serve``, ``apiary index``, ``apiary config``."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from apiary import __version__
from apiary.config import Config

app = typer.Typer(
    add_completion=False,
    help="Apiary: your Claude Code sessions, kept like bees. Each repo a hive, each session a cell.",
)

ConfigOpt = Annotated[Path | None, typer.Option("--config", "-c", help="Path to apiary.toml")]


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    version: Annotated[bool, typer.Option("--version", help="Show version and exit")] = False,
) -> None:
    if version:
        typer.echo(f"apiary {__version__}")
        raise typer.Exit()
    if ctx.invoked_subcommand is None:
        typer.echo(ctx.get_help())
        raise typer.Exit()


@app.command()
def serve(
    config: ConfigOpt = None,
    host: Annotated[str | None, typer.Option(help="Override server.host")] = None,
    port: Annotated[int | None, typer.Option(help="Override server.port")] = None,
    reload: Annotated[bool, typer.Option(help="Auto-reload on code changes")] = False,
) -> None:
    """Run the daemon and serve the UI."""
    import uvicorn

    cfg = Config.load(config)
    h = host or cfg.server.host
    p = port or cfg.server.port
    typer.echo(f"apiary {__version__}  http://{h}:{p}  db={cfg.paths.db}")
    if reload:
        uvicorn.run("apiary.api:create_app", factory=True, host=h, port=p, reload=True)
    else:
        from apiary.api import create_app

        uvicorn.run(create_app(cfg), host=h, port=p)


@app.command(name="config")
def show_config(config: ConfigOpt = None) -> None:
    """Print the effective configuration."""
    cfg = Config.load(config)
    typer.echo(f"source:      {cfg.source or '(defaults)'}")
    typer.echo(f"claude_dir:  {cfg.paths.claude_dir}")
    typer.echo(f"db:          {cfg.paths.db}")
    typer.echo(f"archive_dir: {cfg.paths.archive_dir}")
    typer.echo(f"server:      {cfg.server.host}:{cfg.server.port}")
