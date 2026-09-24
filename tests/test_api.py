from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from apiary.api import create_app
from apiary.config import Config

from .fixtures import write_transcript


def test_health(config: Config) -> None:
    with TestClient(create_app(config)) as client:
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["ok"] is True


def test_sessions_and_groups(config: Config) -> None:
    now = datetime.now(UTC)
    write_transcript(
        config.paths.claude_dir,
        "/u/src/api-server",
        "a1",
        "Refactor auth",
        start=now - timedelta(days=1),
        turns=6,
        edits=2,
    )
    write_transcript(
        config.paths.claude_dir,
        "/u/src/web-app",
        "b1",
        "Review PR #9",
        start=now - timedelta(days=30),
        turns=2,
    )
    with TestClient(create_app(config)) as client:
        sessions = client.get("/api/sessions").json()
        assert [s["id"] for s in sessions] == ["a1", "b1"]
        assert sessions[0]["groups"] == ["repo:api-server"]
        assert sessions[0]["score"] > sessions[1]["score"]
        assert "code review of a PR" in sessions[1]["reasons"]

        by_score = client.get("/api/sessions", params={"sort": "score"}).json()
        assert by_score[0]["id"] == "a1"

        only = client.get("/api/sessions", params={"group": "repo:web-app"}).json()
        assert [s["id"] for s in only] == ["b1"]

        groups = client.get("/api/groups").json()
        assert {g["id"]: g["member_ids"] for g in groups} == {
            "repo:api-server": ["a1"],
            "repo:web-app": ["b1"],
        }

        assert client.get("/api/sessions/nope").status_code == 404
        assert client.post("/api/index/refresh").json()["unchanged"] == 2


def test_root_serves_something(config: Config) -> None:
    with TestClient(create_app(config)) as client:
        assert client.get("/").status_code == 200


def test_session_exposes_worktree(config: Config) -> None:
    write_transcript(
        config.paths.claude_dir,
        "/u/src/orca/.claude/worktrees/review-pr-1",
        "w1",
        "Review PR 1",
        start=datetime.now(UTC),
    )
    with TestClient(create_app(config)) as client:
        s = client.get("/api/sessions/w1").json()
        assert (s["repo_name"], s["worktree"]) == ("orca", "review-pr-1")


def test_events_websocket_streams_index_changes(config: Config) -> None:
    with TestClient(create_app(config)) as client, client.websocket_connect("/api/events") as ws:
        write_transcript(
            config.paths.claude_dir, "/u/src/api-server", "e1", "Add websocket", start=datetime.now(UTC)
        )
        assert client.post("/api/index/refresh").json()["changed"] == ["e1"]
        seen = []
        while not any(e["type"] == "index.progress" for e in seen):
            seen.append(ws.receive_json())
        assert {"type": "session.live", "id": "e1", "live": True} in seen
        updated = next(e for e in seen if e["type"] == "session.updated")
        assert (updated["session"]["id"], updated["session"]["status"]) == ("e1", "live")
