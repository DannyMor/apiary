# Apiary: everything from a fresh clone with one command.
#   make run          install what is missing, build the UI if stale, serve on http://127.0.0.1:7431
#   make dev          daemon + Vite dev server with hot reload (UI on http://localhost:5173)
#   make test         backend tests + ruff, UI tests + typecheck
#   make help         every target

PORT ?= 7431
HOST ?= 127.0.0.1
WEB := web
WEB_SRC := $(shell find $(WEB)/src -type f 2>/dev/null) $(WEB)/index.html $(WEB)/vite.config.ts $(WEB)/tsconfig.json $(WEB)/package.json

.DEFAULT_GOAL := run
.PHONY: run serve dev index config open prototype test test-backend test-web lint fmt setup build clean distclean help check-tools

run: check-tools .venv/.synced $(WEB)/dist/index.html ## Install if needed, build the UI if stale, then serve
	uv run apiary serve --host $(HOST) --port $(PORT)

serve: check-tools .venv/.synced ## Serve without touching the UI build (prototype at /prototype if web/dist is absent)
	uv run apiary serve --host $(HOST) --port $(PORT)

dev: check-tools .venv/.synced $(WEB)/node_modules/.installed ## Daemon (7431 by default) and Vite on 5173 with hot reload; Ctrl-C stops both
	@trap 'kill 0' EXIT INT TERM; \
	uv run apiary serve --host $(HOST) --port $(PORT) & \
	npm --prefix $(WEB) run dev; wait

index: .venv/.synced ## Index ~/.claude/projects once and print what changed
	uv run apiary index

config: .venv/.synced ## Print the effective configuration
	uv run apiary config

open: ## Open the UI in the browser
	open http://$(HOST):$(PORT)

prototype: ## Open the single-file prototype in the browser
	open http://$(HOST):$(PORT)/prototype

setup: check-tools .venv/.synced $(WEB)/node_modules/.installed ## Install backend and UI dependencies

build: $(WEB)/dist/index.html ## Build the UI into web/dist

test: test-backend test-web ## All tests and checks

test-backend: .venv/.synced ## pytest + ruff
	uv run pytest -q
	uv run ruff check .
	uv run ruff format --check .

test-web: $(WEB)/node_modules/.installed ## Vitest + tsc
	npm --prefix $(WEB) test -- --run
	npm --prefix $(WEB) run typecheck

lint: .venv/.synced $(WEB)/node_modules/.installed ## ruff check + tsc
	uv run ruff check .
	npm --prefix $(WEB) run typecheck

fmt: .venv/.synced ## ruff format
	uv run ruff format .

clean: ## Remove the UI build
	rm -rf $(WEB)/dist

distclean: clean ## Remove the UI build, node_modules and the Python environment
	rm -rf $(WEB)/node_modules .venv

# ---- file rules: each runs only when its inputs are newer than its stamp

.venv/.synced: pyproject.toml uv.lock
	uv sync
	@touch $@

$(WEB)/node_modules/.installed: $(WEB)/package.json $(WEB)/package-lock.json
	npm --prefix $(WEB) ci --no-fund --no-audit
	@touch $@

$(WEB)/dist/index.html: $(WEB)/node_modules/.installed $(WEB_SRC)
	npm --prefix $(WEB) run build

check-tools:
	@command -v uv >/dev/null || { echo "uv is missing: brew install uv  (https://docs.astral.sh/uv/)"; exit 1; }
	@command -v npm >/dev/null || { echo "npm is missing: brew install node"; exit 1; }

help: ## This list
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'
