# Handoff — where Apiary stands (24 Sep 2026, evening)

## Repo

`~/mydev/apiary`, branch `main`, remote `https://github.com/DannyMor/apiary.git` (personal
account; CLAUDE.md has the account rules). Author on every commit is
`Danny Mor <19153512+DannyMor@users.noreply.github.com>`. `git log` tells the story: plan,
skeleton, prototype, indexer, guidance, then the indexer fixes below.

`uv sync && uv run pytest -q && uv run ruff check . && uv run ruff format --check .` all pass
(23 tests). Python 3.12.12 via uv.

## What exists

- `PLAN.md`: architecture, entities, API, vocabulary, build order.
- `src/apiary/`: `config.py` (TOML at `~/.config/apiary/apiary.toml`, `APIARY_CONFIG`),
  `db.py` (schema v2, migrated in place), `models.py`, `transcript.py` (defensive JSONL
  reader), `scoring.py` (rule-based keep-score 0–100 with reasons), `indexer.py`
  (incremental, one file per session, forks, relocations, purge, repo groups, scores),
  `api.py` (`/api/health`, `/api/sessions` with sort/group/status, `/api/sessions/{id}`,
  `/api/groups`, `/api/index/refresh|status`, serves the UI at `/`), `cli.py`.
- `tests/`: 23 tests built from the real transcript shapes (`tests/fixtures.py` writes
  plain, forked, preambled and custom-titled transcripts).
- `web/prototype/apiary.html`: the complete UI prototype on mock data.

## How the indexer models a session (verified against `~/.claude/projects`, 24 Sep 2026)

- **A session is a transcript file; `sessions.id` is the file stem.** A fork begins with its
  ancestors' records copied verbatim, each still carrying the ancestor's `sessionId`; those
  records only set `parent_id` (the nearest ancestor) and are not counted as the fork's
  conversation. Real data: 5 forks, one chain three deep, all with the right parent, and
  `fork with no divergence` fires for the ones that edited ≤ 1 file.
- **A relocated session leaves a frozen copy behind** in its old project dir under the same
  name (`relocated` records mark the move). Only the newest file per stem is indexed; the
  rest are reported as `superseded`. Purging is by session id, so a move is not a
  disappearance.
- **Title precedence:** `custom-title` record (written when a session is renamed) → first
  user prompt that is not `isMeta` (skill preambles are `isMeta`) → `summary` record.
- **Hive = repo.** A cwd under `<repo>/.claude/worktrees/<name>` belongs to `<repo>`; the
  worktree name is kept in `sessions.worktree`. Re-indexing a session drops stale repo
  memberships; repo groups with no unpurged members are deleted (custom groups stay).
- **Two version stamps in `meta`.** `SCHEMA_VERSION` runs `MIGRATIONS` on an existing
  database (fresh ones get the full `SCHEMA`); bump `INDEX_VERSION` whenever parsing or row
  derivation changes and every file is re-read once on the next index.

Numbers on this machine after the fixes: 62 files → 60 sessions + 2 superseded copies,
7 hives (was 24), 0 preamble titles (was 8), second `apiary index` = `indexed 0` in 0.01s.

Record types seen and ignored on purpose: `attachment`, `queue-operation`, `last-prompt`,
`mode`, `pr-link`, `system`, `atis-latch`, `worktree-state`, `frame-link`,
`file-history-snapshot`, `agent-name`, `permission-mode`. `msg_count` still counts tool
results (they are `user` records), so it overstates conversation length; `agent-name`
(`agentName`) could be a title fallback for named agent sessions. Neither is urgent.

## Decisions already made (don't reopen without reason)

- White world, camera-relative everything, no fog; unlit floor with a shadow layer.
- Glow = selective Gaussian pass composited as a colored veil (additive glow is
  invisible on light backgrounds; UnrealBloomPass produces blotches at tight radii).
- Filtered-out cells are solid pale grey, not transparent.
- Selection bar is a docked footer, not an overlay.
- Group colors: curated OKLCH hues avoiding the olive/mustard band; UI accent is ink.

## Next

Stage 5: `watcher.py` with `watchfiles`, `WS /api/events`, live status pushed to the UI;
then stage 6 moves swarms, tags and keeper decisions from browser storage into SQLite.
