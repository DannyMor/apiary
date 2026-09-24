# Handoff — where Apiary stands (23 Sep 2026)

## Immediate task

Get the repo into git under the **personal** GitHub account (a repo created by mistake under
the work account has already been deleted). If `~/mydev/apiary` is not a git repo yet, either
`git init -b main && git add -A && git commit` or use `history/make-history.sh` from the kit.
Then:

1. Look in `~/mydev` for the account-switching helper scripts and use them.
2. `gh auth status`: confirm the active account is the personal one; show it and ask
   before continuing.
3. `gh repo create <personal>/apiary --private --source=. --remote=origin --push`.
4. Confirm the commits' author email is the personal one; amend/rebase if not.
5. Run `uv run apiary index` and sanity-check `/api/sessions` against real transcripts.

## What exists

- `PLAN.md`: architecture, entities, API, vocabulary, build order.
- `src/apiary/`: `config.py` (TOML at `~/.config/apiary/apiary.toml`, `APIARY_CONFIG`),
  `db.py` (full schema, versioned), `models.py`, `transcript.py` (defensive JSONL reader),
  `scoring.py` (rule-based keep-score 0–100 with reasons), `indexer.py` (mtime/size
  incremental, marks vanished transcripts `purged`, creates repo groups, scores),
  `api.py` (`/api/health`, `/api/sessions` with sort/group/status, `/api/sessions/{id}`,
  `/api/groups`, `/api/index/refresh|status`, serves the UI at `/`), `cli.py`.
- `tests/`: 11 tests, all passing; ruff clean.
- `web/prototype/apiary.html`: the complete UI prototype on mock data.

## Things to verify first on this machine

- `uv run apiary index` against the real `~/.claude/projects`, then
  `curl localhost:7431/api/sessions | head`. The transcript format was inferred; if
  titles, counts or timestamps look wrong, fix `transcript.py` against real lines.
- Fork detection (`parent_id`) is not implemented; find where Claude records it.

## Decisions already made (don't reopen without reason)

- White world, camera-relative everything, no fog; unlit floor with a shadow layer.
- Glow = selective Gaussian pass composited as a colored veil (additive glow is
  invisible on light backgrounds; UnrealBloomPass produces blotches at tight radii).
- Filtered-out cells are solid pale grey, not transparent.
- Selection bar is a docked footer, not an overlay.
- Group colors: curated OKLCH hues avoiding the olive/mustard band; UI accent is ink.

## Next stage

Stage 5: `watcher.py` with `watchfiles`, `WS /api/events`, live status pushed to the
UI; then stage 6 moves swarms, tags and keeper decisions from browser storage into SQLite.
