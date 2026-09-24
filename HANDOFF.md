# Handoff — where Apiary stands (25 Sep 2026)

## Repo

`~/mydev/apiary`, branch `main`, remote `https://github.com/DannyMor/apiary.git` (personal
account; CLAUDE.md has the account rules). Author on every commit is
`Danny Mor <19153512+DannyMor@users.noreply.github.com>`. `git log` tells the story: plan,
skeleton, prototype, indexer, guidance, the indexer fixes, stage 5 (watcher + events), stage 6
(swarms, tags, decisions, settings, colors), stage 7 part one (the prototype runs on the API).

`uv sync && uv run pytest -q && uv run ruff check . && uv run ruff format --check .` all pass
(44 tests). Python 3.12.12 via uv. `uv run apiary serve` then open http://127.0.0.1:7431;
`.claude/launch.json` starts the same for the in-app browser.

## What exists

- `PLAN.md`: architecture, entities, API, vocabulary, build order.
- `src/apiary/`: `config.py` (TOML at `~/.config/apiary/apiary.toml`, `APIARY_CONFIG`),
  `db.py` (schema v2, migrated in place), `models.py`, `transcript.py` (defensive JSONL
  reader), `scoring.py` (rule-based keep-score 0–100 with reasons), `indexer.py`
  (incremental, one file per session, forks, relocations, purge, repo groups, scores),
  `queries.py` (one session/group shape for the API and the event stream), `watcher.py`
  (`Hub`, `Watcher`: re-index on file events and on a 30s tick, publish events),
  `curation.py` (swarms, tags, decisions, settings: the writes a person makes; raises
  `UnknownId` → 404 and `RepoHive` → 409), `colors.py` (OKLCH suggestions ported from the
  prototype), `api.py` (everything under `/api`, `WS /api/events`, serves the UI at `/`),
  `cli.py`.
- `tests/`: 43 tests built from the real transcript shapes (`tests/fixtures.py` writes
  plain, forked, preambled and custom-titled transcripts). `tests/test_watcher.py` drives a
  real `watchfiles` watcher on a temp dir; the API tests read the websocket.
- `web/prototype/apiary.html`: the complete UI, live on the daemon's data since stage 7
  (see its README for the rules). No test harness: it is verified in the browser.

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

## Stage 5: live status over a websocket (done 24 Sep 2026)

`WS /api/events` sends JSON events, in this order per index run:

    {"type": "session.updated", "session": <SessionOut>}   indexed, purged or live/idle flipped
    {"type": "session.live",    "id": "<id>", "live": true|false}
    {"type": "index.progress",  "report": <IndexReport>}    only after a run that published

The `Watcher` runs on the app's event loop: `watchfiles.awatch` on `claude_dir` (2s debounce)
and a 30s tick, because a live session turns idle through silence that no file event
announces (`LIVE_WINDOW_SECONDS = 120`). `POST /api/index/refresh` runs the same
`run_once`, so its changes reach subscribers too. `IndexReport.changed` lists the ids a run
indexed or purged.

Verified against the real server: `uv run apiary serve`, a websocket client connected, and
118s later the running Claude Code session went silent past the window: `session.updated`
(status idle), `session.live false`, `index.progress` arrived in that order; shutdown clean.

Known cost: a live transcript is re-read whole on every debounce (a 20 MB file takes ~100 ms).
If that ever matters, parse from a stored byte offset instead.

## Stage 6: what the person curates lives in SQLite (done 25 Sep 2026)

Everything the prototype kept in `localStorage` now has an endpoint, so stage 7 can drop it:

    GET  /api/groups                       hives and swarms, `member_ids` without purged sessions
    POST /api/groups {name, color?, member_ids}   → 201 Group, id `swarm:<8 hex>`, color suggested if omitted
    PATCH /api/groups/{id} {name?, color?}        hives too (label and color are the person's)
    DELETE /api/groups/{id}                 swarms only (409 on a hive) → 204
    POST /api/groups/{id}/members {session_ids}   DELETE /api/groups/{id}/members/{sid}   swarms only
    GET  /api/tags → [{tag, count}]         POST /api/sessions/{id}/tags {tag}   DELETE /api/sessions/{id}/tags/{tag}
    GET  /api/gc/candidates?threshold=35    idle, score < threshold, not marked keep; worst first
    POST /api/gc/decisions {session_id, decision}  keep | archive | summarize_archive → SessionOut
    DELETE /api/gc/decisions/{sid}
    GET  /api/settings   PUT /api/settings {…}     merged JSON key/value; a null value deletes the key
    GET  /api/colors/suggest?n=4&exclude=…  OKLCH "l c h" strings clear of every group color

`SessionOut` gained `decision`; `groups` and `tags` on it are sorted. A session may be in
several swarms (the prototype allowed one; the schema never did). Every write publishes
`session.updated` for the sessions involved, plus `group.updated` / `group.deleted` /
`settings.updated` (contract in `watcher.py`). Unknown ids are 404, edits to a hive's
members or deleting a hive are 409. Repo hives are colored by the indexer on creation
(and backfilled on the next index for databases from before colors existed).

Applying `archive` / `summarize_archive` decisions is stage 8; a decision is only recorded.

## Stage 7, part one: the prototype runs on the daemon (done 25 Sep 2026)

Mock data, client-side scoring and `localStorage` are gone from `web/prototype/apiary.html`.
An `api` section loads `/api/sessions?limit=5000`, `/api/groups`, `/api/settings`, maps the
API shape to the prototype's (`sessionFromApi`: seconds → ms, `status === 'live'` → `active`,
the `repo:` group → home hive, `swarm:` groups → `swarms`, tags and decisions mirrored into
`state.tags` / `state.decisions`), subscribes to `/api/events` and applies every event with an
80 ms debounced `rebuildScene() + renderTray()` (`redrawSoon`). Every former `save()` site
calls the matching endpoint and then refreshes the sessions involved; errors surface as a
toast. Settings writes are debounced 300 ms and merged. A dot at the bottom right shows the
websocket state and reconnects with backoff.

Verified in the in-app browser against the real daemon: create a swarm from a selection,
recolor, add and remove a tag, keep / archive / undo in the keeper, world color and section
collapse, a full reload restoring all of it from the server, and swarm create/delete driven
from the API showing up live. Console clean after two fixes: a session refreshed by a write
keeps its layout fields (`displayGroup`, `pos`, `slot`) until the next rebuild, and label,
minimap and focus code skip groups that have no layout center yet.

Rules the UI now follows: a cell in several swarms is drawn in the first swarm (hives first,
then swarms by name) and ghosted in its home hive; a swarm's tray section lists every
member; hives can be renamed and recolored but not dissolved or edited; keeper buttons only
record a decision (`marked: archive`, with Undo) because applying is stage 8; the row meta
shows the worktree name when there is one.

## Decisions already made (don't reopen without reason)

- White world, camera-relative everything, no fog; unlit floor with a shadow layer.
- Glow = selective Gaussian pass composited as a colored veil (additive glow is
  invisible on light backgrounds; UnrealBloomPass produces blotches at tight radii).
- Filtered-out cells are solid pale grey, not transparent.
- Selection bar is a docked footer, not an overlay.
- Group colors: curated OKLCH hues avoiding the olive/mustard band; UI accent is ink.

## Next

Stage 7, part two: the React + TypeScript + Vite + react-three-fiber port under `web/`, one
module at a time (api client from the OpenAPI schema, store, tray, world, keeper), built to
`web/dist/` which `api.py` already serves when present; the prototype stays the reference.
Stage 8: the keeper applies decisions (archive moves the transcript into `archive_dir`,
summarize writes honey with `claude -p`, purge), `POST /api/gc/apply`, restore.
