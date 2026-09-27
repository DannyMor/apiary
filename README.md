# Apiary

Every Claude Code session, kept like bees.

An apiary is where the hives are kept. Here every repo is a hive and every session a cell in its comb: tall and vivid when
touched recently, low and grey when idle, glowing while it runs. Sessions can be
gathered into swarms (a task force, a customer, an epic) across hives,
labelled, filtered, scored, and archived with a summary when they are no longer
worth keeping.

Apiary runs as a small local daemon that reads the transcripts Claude Code already
writes, keeps an index in SQLite, and serves a browser UI on localhost.

See [PLAN.md](PLAN.md) for the architecture and the build order.

## Run it

    uv sync
    uv run apiary index      # reads ~/.claude/projects into ~/.local/share/apiary/apiary.db
    uv run apiary serve      # http://127.0.0.1:7431

The daemon serves the React UI from `web/dist` when it exists (`cd web && npm install && npm run build`),
and the single-file prototype at `/prototype` either way. Copy `apiary.example.toml` to
`~/.config/apiary/apiary.toml` to change paths or the keeper's summarizer command.

    uv run pytest -q         # backend tests
    cd web && npm test       # UI tests
