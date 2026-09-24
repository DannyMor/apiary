from fastapi.testclient import TestClient

from apiary.api import create_app
from apiary.config import Config

from .fixtures import two_sessions


def test_tags_are_added_listed_and_removed(config: Config) -> None:
    two_sessions(config)
    with TestClient(create_app(config)) as client, client.websocket_connect("/api/events") as ws:
        r = client.post("/api/sessions/s1/tags", json={"tag": " billing "})
        assert r.status_code == 200 and r.json()["tags"] == ["billing"]
        pushed = ws.receive_json()
        assert (pushed["type"], pushed["session"]["id"], pushed["session"]["tags"]) == (
            "session.updated",
            "s1",
            ["billing"],
        )

        client.post("/api/sessions/s2/tags", json={"tag": "billing"})
        client.post("/api/sessions/s2/tags", json={"tag": "needs-review"})
        assert client.get("/api/tags").json() == [
            {"tag": "billing", "count": 2},
            {"tag": "needs-review", "count": 1},
        ]

        assert client.delete("/api/sessions/s2/tags/billing").json()["tags"] == ["needs-review"]
        assert client.get("/api/tags").json() == [
            {"tag": "billing", "count": 1},
            {"tag": "needs-review", "count": 1},
        ]


def test_tag_validation(config: Config) -> None:
    two_sessions(config)
    with TestClient(create_app(config)) as client:
        assert client.post("/api/sessions/s1/tags", json={"tag": "   "}).status_code == 422
        assert client.post("/api/sessions/nope/tags", json={"tag": "x"}).status_code == 404
        assert client.delete("/api/sessions/s1/tags/absent").json()["tags"] == []
