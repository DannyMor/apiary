# Apiary — project instructions for Claude Code

Apiary is a personal side project: every Claude Code session, kept like bees. A local
daemon indexes the transcripts Claude Code writes, keeps them in SQLite, and serves a
3D honeycomb UI. See PLAN.md for architecture and build order; this file is the
standing guidance.

## Accounts and remotes — read before any git/gh action

- This repo lives under `~/mydev` and belongs to the **personal** GitHub account
  `DannyMor` (remote `https://github.com/DannyMor/apiary.git`), never the work account
  `dannymor-orca`. `gh` holds both logins and the work one stays active for daily work.
  Pushes route by git config, no switching: `credential.https://github.com.useHttpPath` is
  on and `credential.https://github.com/DannyMor.username` is `DannyMor`, so git asks for
  that user and the fallback helper `~/mydev/tools/github/git-credential-gh-user` answers
  with `gh auth token -u DannyMor`. A plain `git push` is correct; never `gh auth switch`.
  `gh api` calls for this repo need the token explicitly:
  `-H "Authorization: token $(gh auth token -u DannyMor)"`.
- `~/mydev/tools/github/gh_env.zsh` (`gpr`, `gmerge`, `gpush`) is the alternative: it reads a
  per-repo fine-grained token from the macOS Keychain (`store_github_token apiary <token>`).
  No token is stored for apiary, so the routing above is the working path.
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
- The UI is `web/`: React 19 + TypeScript + Vite + Zustand, with three.js in an imperative
  `WorldEngine` (not react-three-fiber). `cd web && npm test && npm run build` must pass;
  `web/dist` is served by the daemon at `/` and is not committed. The prototype
  `web/prototype/apiary.html` (served at `/prototype`) stays the visual reference: when the
  two disagree about look or behavior, the prototype wins until the difference is deliberate.
- Commit in stages with clear messages, one concern per commit. The first four commits
  (plan, skeleton, prototype, indexer) set the pattern.

## Build order (PLAN.md has detail)

1 plan ✓ · 2 skeleton ✓ · 3 prototype ✓ · 4 indexer ✓ · 5 watcher + live status ✓ ·
6 groups/tags/decisions/settings in SQLite ✓ · 7 frontend wiring (prototype on the API ✓,
React port ✓) · 8 keeper: archive, honey with `claude -p`, restore, purge ✓.
