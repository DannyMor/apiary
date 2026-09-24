from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from apiary.api import create_app
from apiary.config import Config

from .fixtures import two_sessions, write_transcript


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
        "/u/src/hive/.claude/worktrees/review-pr-1",
        "w1",
        "Review PR 1",
        start=datetime.now(UTC),
    )
    with TestClient(create_app(config)) as client:
        s = client.get("/api/sessions/w1").json()
        assert (s["repo_name"], s["worktree"]) == ("hive", "review-pr-1")


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


def test_swarm_lifecycle(config: Config) -> None:
    two_sessions(config)
    with TestClient(create_app(config)) as client:
        r = client.post("/api/groups", json={"name": "Billing", "member_ids": ["s1", "s2"]})
        assert r.status_code == 201
        g = r.json()
        assert g["kind"] == "custom" and g["id"].startswith("swarm:") and g["member_ids"] == ["s1", "s2"]
        assert g["color"] is not None
        assert client.get("/api/sessions/s1").json()["groups"] == ["repo:a", g["id"]]

        g2 = client.patch(
            f"/api/groups/{g['id']}", json={"name": "Billing Q3", "color": "0.64 0.21 300"}
        ).json()
        assert (g2["name"], g2["color"]) == ("Billing Q3", "0.64 0.21 300")

        assert client.delete(f"/api/groups/{g['id']}/members/s2").json()["member_ids"] == ["s1"]
        added = client.post(f"/api/groups/{g['id']}/members", json={"session_ids": ["s2"]}).json()
        assert added["member_ids"] == ["s1", "s2"]

        assert client.delete(f"/api/groups/{g['id']}").status_code == 204
        assert [x["id"] for x in client.get("/api/groups").json()] == ["repo:a", "repo:b"]
        assert client.get("/api/sessions/s1").json()["groups"] == ["repo:a"]


def test_repo_hives_are_recolorable_but_their_members_are_the_indexers(config: Config) -> None:
    two_sessions(config)
    with TestClient(create_app(config)) as client:
        assert (
            client.patch("/api/groups/repo:a", json={"color": "0.64 0.21 300"}).json()["color"]
            == "0.64 0.21 300"
        )
        assert client.post("/api/groups/repo:a/members", json={"session_ids": ["s2"]}).status_code == 409
        assert client.delete("/api/groups/repo:a/members/s1").status_code == 409
        assert client.delete("/api/groups/repo:a").status_code == 409


def test_unknown_group_or_session_is_404(config: Config) -> None:
    two_sessions(config)
    with TestClient(create_app(config)) as client:
        assert client.post("/api/groups", json={"name": "x", "member_ids": ["nope"]}).status_code == 404
        assert client.patch("/api/groups/swarm:nope", json={"name": "y"}).status_code == 404
        assert client.get("/api/groups").json()[0]["id"] == "repo:a"


def test_group_changes_are_pushed(config: Config) -> None:
    two_sessions(config)
    with TestClient(create_app(config)) as client, client.websocket_connect("/api/events") as ws:
        r = client.post("/api/groups", json={"name": "Billing", "member_ids": ["s1"]})
        assert r.status_code == 201
        g = r.json()
        first, second = ws.receive_json(), ws.receive_json()
        assert first == {"type": "group.updated", "group": g}
        assert (second["type"], second["session"]["id"], second["session"]["groups"]) == (
            "session.updated",
            "s1",
            ["repo:a", g["id"]],
        )
        client.delete(f"/api/groups/{g['id']}")
        assert ws.receive_json() == {"type": "group.deleted", "id": g["id"]}
        assert ws.receive_json()["session"]["groups"] == ["repo:a"]


def test_color_suggestions_avoid_existing_group_colors(config: Config) -> None:
    two_sessions(config)
    with TestClient(create_app(config)) as client:
        taken = {g["color"] for g in client.get("/api/groups").json()}
        assert len(taken) == 2
        r = client.get("/api/colors/suggest", params={"n": 4})
        assert r.status_code == 200
        suggested = r.json()
        assert len(suggested) == 4 and not set(suggested) & taken
        assert client.get("/api/colors/suggest", params={"exclude": suggested[0]}).json()[0] != suggested[0]


def test_root_answers_head_requests(config: Config) -> None:
    with TestClient(create_app(config)) as client:
        assert client.head("/").status_code == 200
