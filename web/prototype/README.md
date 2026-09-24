# Prototype UI

`apiary.html` is the single-file UI, plain three.js, served by `apiary serve` at `/` until
the React UI in `web/dist/` exists. It established the visual language and every
interaction, and since stage 7 it runs on the daemon's data: `/api/sessions`,
`/api/groups` and `/api/settings` on load, `/api/events` for live updates, and the
stage 6 endpoints for every write. Nothing is kept in the browser.

A cell that belongs to several swarms is drawn in the first swarm (hives first, then
swarms by name) and ghosted in its home hive; every swarm's tray section lists all of
its members. Keeper buttons record a decision; applying it is stage 8.

It is kept as the reference for the port: when the React version and this file
disagree about how something should look or behave, this file wins until the
difference is deliberate.
