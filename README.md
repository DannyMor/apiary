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
