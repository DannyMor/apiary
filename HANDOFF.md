# Handoff — where Apiary stands (24 Sep 2026)

## Repo

`~/mydev/apiary`, branch `main`, remote `https://github.com/DannyMor/apiary.git` (personal
account; see CLAUDE.md for the account rules). Five commits: plan, skeleton, prototype,
indexer, Claude Code guidance. Author on every commit is
`Danny Mor <19153512+DannyMor@users.noreply.github.com>`.

`uv sync && uv run pytest -q && uv run ruff check . && uv run ruff format --check .` all pass
on this machine (11 tests). Python 3.12.12 via uv.

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

## What the real transcripts showed (indexed `~/.claude/projects` on 24 Sep 2026)

`uv run apiary index`: 63 files scanned in 0.9s, 56 session rows, 24 repo groups, 1 live.
Timestamps, `cwd`, `gitBranch`, `isSidechain`, message counts and live detection all behave.
Three things do not, and they should be fixed before stage 5 builds on session identity:

1. **One `sessionId` can span several files.** 5 ids cover 12 files, in two shapes:
   the same id in two project dirs after a worktree move (`relocated` records exist), and
   files whose stem differs from the `sessionId` inside them (resumes/forks; e.g. three
   files in one project dir all carry the same id). `sessions.id` is the sessionId, so the
   later file overwrites the row and its `transcript` path, and the other files re-index on
   every refresh (`indexed 7` each time). Key rows on the transcript path (or file stem),
   keep `session_id` as a column, and treat stem ≠ sessionId as the fork signal:
   `parent_id = sessionId`. That also answers the open question about fork detection.
2. **Titles pick up injected preambles.** First user text is often a skill preamble
   ("Base directory for this skill: …", "Review target: …", "The user just ran /insights…").
   Claude Code writes `custom-title` records (`customTitle`, 4500 seen) and `last-prompt`
   records; prefer `custom-title`, then the first user text that is not a preamble.
3. **Worktrees masquerade as repos.** `cwd` like
   `~/src/<repo>/.claude/worktrees/<name>` gives `repo_name = <name>`,
   so 24 groups exist for about 8 real repos. Collapse `<repo>/.claude/worktrees/<wt>` to
   `<repo>` for the hive, keep the worktree name on the session.

Record types seen and correctly ignored: `attachment`, `queue-operation`, `last-prompt`,
`custom-title`, `mode`, `pr-link`, `system`, `atis-latch`, `relocated`, `worktree-state`,
`frame-link`, `file-history-snapshot`, `agent-name`, `permission-mode`.

## Decisions already made (don't reopen without reason)

- White world, camera-relative everything, no fog; unlit floor with a shadow layer.
- Glow = selective Gaussian pass composited as a colored veil (additive glow is
  invisible on light backgrounds; UnrealBloomPass produces blotches at tight radii).
- Filtered-out cells are solid pale grey, not transparent.
- Selection bar is a docked footer, not an overlay.
- Group colors: curated OKLCH hues avoiding the olive/mustard band; UI accent is ink.

## Next

Fix the three indexer findings above (with tests built from the real shapes), then stage 5:
`watcher.py` with `watchfiles`, `WS /api/events`, live status pushed to the UI; then stage 6
moves swarms, tags and keeper decisions from browser storage into SQLite.
