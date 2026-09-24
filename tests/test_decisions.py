from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from apiary.api import create_app
from apiary.config import Config

from .fixtures import write_transcript


def test_keeper_candidates_and_decisions(config: Config) -> None:
    claude, now = config.paths.claude_dir, datetime.now(UTC)
    write_transcript(
        claude, "/u/src/a", "hi", "Refactor auth", start=now - timedelta(days=1), turns=8, edits=4
    )
    write_transcript(claude, "/u/src/a", "lo1", "Fix typo", start=now - timedelta(days=60), turns=2)
    write_transcript(claude, "/u/src/a", "lo2", "Review PR #1", start=now - timedelta(days=50), turns=2)
    write_transcript(claude, "/u/src/a", "run", "working", start=now)
    with TestClient(create_app(config)) as client:
        cands = client.get("/api/gc/candidates", params={"threshold": 40}).json()
        assert [c["id"] for c in cands] == ["lo1", "lo2"]
        assert all(c["score"] < 40 and c["decision"] is None for c in cands)

        kept = client.post("/api/gc/decisions", json={"session_id": "lo1", "decision": "keep"})
        assert kept.status_code == 200 and kept.json()["decision"] == "keep"
        assert [c["id"] for c in client.get("/api/gc/candidates", params={"threshold": 40}).json()] == ["lo2"]

        client.post("/api/gc/decisions", json={"session_id": "lo2", "decision": "summarize_archive"})
        cands = client.get("/api/gc/candidates", params={"threshold": 40}).json()
        assert [(c["id"], c["decision"]) for c in cands] == [("lo2", "summarize_archive")]

        assert client.delete("/api/gc/decisions/lo1").json()["decision"] is None
        assert [c["id"] for c in client.get("/api/gc/candidates", params={"threshold": 40}).json()] == [
            "lo1",
            "lo2",
        ]


def test_decision_validation(config: Config) -> None:
    write_transcript(
        config.paths.claude_dir, "/u/src/a", "s1", "one", start=datetime.now(UTC) - timedelta(days=1)
    )
    with TestClient(create_app(config)) as client:
        assert (
            client.post("/api/gc/decisions", json={"session_id": "s1", "decision": "burn"}).status_code == 422
        )
        assert (
            client.post("/api/gc/decisions", json={"session_id": "nope", "decision": "keep"}).status_code
            == 404
        )
