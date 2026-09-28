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

    make run                 # installs what is missing, builds the UI if stale, serves http://127.0.0.1:7431

Needs `uv` and `npm` (`brew install uv node`); `make` tells you if one is missing. `make help` lists the
rest: `make dev` (daemon plus Vite with hot reload on 5173), `make test`, `make index`, `make config`,
`make open`. `PORT=8000 make run` changes the port.

By hand: `uv sync`, `uv run apiary index`, `uv run apiary serve`; `cd web && npm ci && npm run build`
for the UI. The daemon serves the React UI from `web/dist` when it exists and the single-file prototype
at `/prototype` either way. Copy `apiary.example.toml` to `~/.config/apiary/apiary.toml` to change paths,
the keeper's summarizer command or the desktop-app link settings.

A session's row (and a double-click on its cell) opens it in the Claude desktop app; the
`[desktop_app]` section of the config holds the app internals that makes that possible.

