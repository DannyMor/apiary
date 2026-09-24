# Apiary: plan

## Vocabulary

The metaphor is a working apiary, and the words are used consistently in the
UI, the code and the docs:

| word    | meaning                                                                 |
|---------|-------------------------------------------------------------------------|
| apiary  | the whole world: everything Claude Code has been working on              |
| hive    | one repo's region, with its own color                                    |
| cell    | one session: a hexagonal column, tall and vivid when fresh               |
| swarm   | a custom group of cells drawn from several hives (a task force, an epic) |
| keeper  | the garbage-collection assistant that recommends what to cull            |
| honey   | the summary written when a cell is archived                              |

## What it is

A local tool that visualises and manages Claude Code sessions as an apiary: a 3D
world of honeycomb hives, with a tray for listing, grouping, filtering and labelling sessions, and a
garbage-collection flow that recommends, summarises and archives sessions that
are no longer worth keeping.

## Shape

One local process (`apiary serve`) that

- owns a SQLite database,
- indexes the transcripts Claude Code writes under `~/.claude/projects/`,
- watches that directory so running sessions show up live,
- exposes a small HTTP API on localhost,
- serves the browser UI.

Nothing leaves the machine. Claude's own files are never modified; archiving
moves a transcript into a directory Apiary owns and writes a summary next to it.

## Configuration

`~/.config/apiary/apiary.toml` (or `APIARY_CONFIG=/path/to/apiary.toml`):

```toml
[paths]
claude_dir  = "~/.claude/projects"
db          = "~/.local/share/apiary/apiary.db"
archive_dir = "~/.local/share/apiary/archive"

[server]
host = "127.0.0.1"
port = 7431

[scoring]
policy = "~/.config/apiary/policy.yaml"
```

## Backend

Python 3.12, managed with `uv`.

- **FastAPI + uvicorn**: async fits the file watcher and a websocket without
  threads; Pydantic models double as the entity definitions and the OpenAPI
  spec feeds a generated TypeScript client later.
- **sqlite3** (stdlib), WAL mode, indices on `(repo_name, last_active_at)`,
  `mtime`, `parent_id`, `score`. The database is a rebuildable index: `SCHEMA_VERSION`
  migrates it in place, `INDEX_VERSION` forces a full re-read when parsing changes.
- **watchfiles** for the directory watcher.
- **typer** for the CLI: `apiary serve`, `apiary index`, `apiary config`.

Modules under `src/apiary/`:

| module          | role                                                           |
|-----------------|----------------------------------------------------------------|
| `config.py`     | load and validate the TOML config, expand paths                |
| `db.py`         | connection, schema, migrations                                 |
| `models.py`     | Pydantic entities                                              |
| `indexer.py`    | walk `claude_dir`, one file per session, re-parse only what changed |
| `watcher.py`    | file events → live status, incremental reindex, websocket push |
| `scoring.py`    | features → weighted score + reasons, from a policy             |
| `gc.py`         | archive / summarise / purge                                    |
| `summarizer.py` | `claude -p` over a transcript with a fixed prompt              |
| `api.py`        | routers over the above, static UI                              |

## Entities

```
Session      id (transcript file stem), repo_path, repo_name, worktree, branch, title,
             created_at, last_active_at, mtime, size_bytes, msg_count, tool_calls,
             files_edited, parent_id (session forked from),
             status (live | idle | archived | purged)
Group        id, name, kind (repo | custom), color_oklch
GroupMember  group_id, session_id
Tag          session_id, tag
Score        session_id, score, reasons[], policy_version, scored_at
Policy       id, yaml, version
GcDecision   session_id, decision (keep | archive | summarize_archive), decided_at, applied_at
Summary      session_id, path, model, created_at
Setting      key, value
```

Repo groups are created by the indexer; custom groups and tags are the only
things the user creates. Membership keys on the session id, so it survives a
reindex.

## API

```
GET  /api/health
GET  /api/sessions?sort=&group=&status=          list with metadata
GET  /api/sessions/{id}                           detail, transcript head/tail
GET  /api/groups                                  repo + custom groups
POST /api/groups                                  {name, color, member_ids}
PATCH /api/groups/{id}                            rename, recolor
POST /api/groups/{id}/members   DELETE /api/groups/{id}/members/{sid}
GET  /api/tags   POST /api/sessions/{id}/tags   DELETE /api/sessions/{id}/tags/{tag}
GET  /api/colors/suggest?exclude=                 suggested OKLCH values

GET  /api/policy   PUT /api/policy
POST /api/scores/recompute
GET  /api/gc/candidates?threshold=
POST /api/gc/decisions                            {session_id, decision}
POST /api/gc/apply
POST /api/sessions/{id}/summarize
POST /api/gc/purge

POST /api/index/refresh   GET /api/index/status
WS   /api/events                                  session.updated, session.live, index.progress
GET  /api/settings   PUT /api/settings
```

## Frontend

Stage 3 ships the single-file prototype (`web/prototype/apiary.html`, plain
three.js) served by the daemon. It establishes the visual language and every
interaction: recency/score height lenses, click-to-focus camera, tray with
group-by / order-by / filters, labels, custom groups, the GC flow, world color.

The production UI will be React + TypeScript + Vite with react-three-fiber and
Zustand, built to `web/dist/` and served by the same daemon. It ports the
prototype one module at a time, replacing mock data with the API.

## Build order

1. **Plan** (this document).
2. **Skeleton**: uv project, config, database schema, CLI, FastAPI app with a
   health endpoint and static serving, tests.
3. **Prototype**: the single-file UI served at `/`.
4. **Indexer**: read real transcripts into SQLite; `/api/sessions`; scoring.
5. **Watcher + live status**: websocket events, running sessions glow for real.
6. **Groups, tags, decisions** persisted in SQLite instead of the browser.
7. **Frontend wiring**: prototype reads the API; then the React port.
8. **GC**: archive, summarise with `claude -p`, purge.
