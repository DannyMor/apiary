# Apiary — project instructions for Claude Code

Apiary is a personal side project: every Claude Code session, kept like bees. A local
daemon indexes the transcripts Claude Code writes, keeps them in SQLite, and serves a
3D honeycomb UI. See PLAN.md for architecture and build order; this file is the
standing guidance.

## Accounts and remotes — read before any git/gh action

- This repo lives under `~/mydev` and belongs to the **personal** GitHub account
  `DannyMor` (remote `https://github.com/DannyMor/apiary.git`), never the work account
  `dannymor-orca`. `gh` holds both logins and the work one stays active for daily work.
  Wrap every `gh` call and every push: `gh auth switch -u DannyMor`, do the action, then
  `gh auth switch -u dannymor-orca`.
- `~/mydev/tools/github/gh_env.zsh` (`gpr`, `gmerge`, `gpush`) is the alternative: it reads a
  per-repo fine-grained token from the macOS Keychain (`store_github_token apiary <token>`).
  No token is stored for apiary yet, so `gh` is the working path.
- Before `gh repo create`, `git push`, or adding a remote: run `gh auth status`, print
  the exact `owner/name` you are about to use, and wait for an explicit yes.
- Commits must carry the personal identity, set locally in this repo:
  `Danny Mor <19153512+DannyMor@users.noreply.github.com>`. Never the orca email.

## Vocabulary (use it in UI copy, docs and commit messages)

apiary = the whole world · hive = one repo's region · cell = one session column ·
swarm = a custom cross-hive group · keeper = the garbage-collection assistant ·
honey = the summary written when a cell is archived. The schema stays literal:
`groups` with `kind` repo|custom, `sessions`, `tags`, `scores`, `gc_decisions`.

## Stack and conventions

- Python 3.12 with `uv`. `uv sync`, `uv run pytest -q`, `uv run ruff check .`,
  `uv run ruff format .` must all pass before a commit. Line length 110.
- FastAPI + uvicorn, Pydantic models in `src/apiary/models.py`, stdlib `sqlite3` with
  WAL; all endpoints are `async def` so the single connection stays on the loop thread.
- CLI is typer: `apiary serve`, `apiary index`, `apiary config`.
- Tests use synthetic transcripts from `tests/fixtures.py`; keep the indexer defensive
  (the transcript format is observed, not specified).
- The UI reference is `web/prototype/apiary.html` (plain three.js, mock data). The
  production UI will be React + TypeScript + Vite + react-three-fiber under `web/`,
  built to `web/dist/`, served by the daemon. Port the prototype one module at a time.
- Commit in stages with clear messages, one concern per commit. The first four commits
  (plan, skeleton, prototype, indexer) set the pattern.

## Build order (PLAN.md has detail)

1 plan ✓ · 2 skeleton ✓ · 3 prototype ✓ · 4 indexer ✓ ·
5 watcher + live status (websocket) · 6 groups/tags/decisions in SQLite ·
7 frontend wiring (prototype reads the API, then the React port) · 8 keeper: archive,
summarise with `claude -p`, purge.
