from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from apiary.api import create_app
from apiary.config import Config

from .fixtures import write_transcript


def _idle(config: Config, *ids: str):
    start = datetime.now(UTC) - timedelta(days=30)
    return [
        write_transcript(config.paths.claude_dir, "/u/src/a", sid, f"prompt {sid}", start=start)
        for sid in ids
    ]


def _decide(client: TestClient, session_id: str, decision: str) -> None:
    assert (
        client.post("/api/gc/decisions", json={"session_id": session_id, "decision": decision}).status_code
        == 200
    )


def test_apply_archives_and_summarizes_pending_decisions(config: Config) -> None:
    p1, p2, _ = _idle(config, "s1", "s2", "s3")

    def fake(prompt: str, extract: str) -> str:
        return "honey for " + ("s2" if "prompt s2" in extract else "?")

    with (
        TestClient(create_app(config, summarizer=fake)) as client,
        client.websocket_connect("/api/events") as ws,
    ):
        _decide(client, "s1", "archive")
        _decide(client, "s2", "summarize_archive")
        _decide(client, "s3", "keep")
        for _ in range(3):
            ws.receive_json()  # the three decisions

        r = client.post("/api/gc/apply")
        assert r.status_code == 200
        assert r.json() == {"archived": ["s1", "s2"], "summarized": ["s2"], "failed": []}
        pushed = [ws.receive_json() for _ in range(2)]
        assert [(e["type"], e["session"]["id"], e["session"]["status"]) for e in pushed] == [
            ("session.updated", "s1", "archived"),
            ("session.updated", "s2", "archived"),
        ]

        s1, s2 = client.get("/api/sessions/s1").json(), client.get("/api/sessions/s2").json()
        assert (s1["status"], s1["has_honey"], s2["status"], s2["has_honey"]) == (
            "archived",
            False,
            "archived",
            True,
        )
        assert client.get("/api/sessions/s2/honey").text.rstrip().endswith("honey for s2")
        assert client.get("/api/sessions/s1/honey").status_code == 404
        assert not p1.exists() and not p2.exists()
        assert (config.paths.archive_dir / "a" / "s1.jsonl").exists()
        assert {s["id"] for s in client.get("/api/sessions", params={"status": "archived"}).json()} == {
            "s1",
            "s2",
        }
        assert client.post("/api/gc/apply").json() == {"archived": [], "summarized": [], "failed": []}


def test_apply_reports_a_failed_summary_and_keeps_the_decision(config: Config) -> None:
    (p1,) = _idle(config, "s1")

    def boom(prompt: str, extract: str) -> str:
        raise RuntimeError("no claude here")

    with TestClient(create_app(config, summarizer=boom)) as client:
        _decide(client, "s1", "summarize_archive")
        assert client.post("/api/gc/apply").json() == {
            "archived": [],
            "summarized": [],
            "failed": [{"session_id": "s1", "error": "no claude here"}],
        }
        s1 = client.get("/api/sessions/s1").json()
        assert (s1["status"], s1["decision"]) == ("idle", "summarize_archive")
        assert p1.exists()


def test_restore_and_purge(config: Config) -> None:
    p1, p2 = _idle(config, "s1", "s2")
    with TestClient(create_app(config, summarizer=lambda p, e: "x")) as client:
        _decide(client, "s1", "archive")
        _decide(client, "s2", "archive")
        client.post("/api/gc/apply")

        restored = client.post("/api/sessions/s1/restore").json()
        assert (restored["status"], restored["decision"]) == ("idle", None)
        assert p1.exists()
        assert client.post("/api/sessions/s1/restore").status_code == 409

        assert client.post("/api/gc/purge", json={"session_ids": ["s1"]}).status_code == 409
        assert client.post("/api/gc/purge", json={"session_ids": ["s2"]}).json() == {"purged": ["s2"]}
        assert client.get("/api/sessions/s2").json()["status"] == "purged"
        assert not (config.paths.archive_dir / "a" / "s2.jsonl").exists()


def test_summarize_on_demand_and_recompute(config: Config) -> None:
    _idle(config, "s1")
    with TestClient(create_app(config, summarizer=lambda p, e: "on demand")) as client:
        r = client.post("/api/sessions/s1/summarize")
        assert r.status_code == 200 and r.json()["text"].rstrip().endswith("on demand")
        assert client.get("/api/sessions/s1").json()["has_honey"] is True
        assert client.get("/api/sessions/s1/honey").text == r.json()["text"]
        assert client.post("/api/scores/recompute").json() == {"rescored": 1}
