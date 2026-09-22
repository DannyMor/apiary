from fastapi.testclient import TestClient

from apiary.api import create_app
from apiary.config import Config


def test_health(config: Config) -> None:
    with TestClient(create_app(config)) as client:
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["sessions"] == 0
        assert body["db"].endswith("apiary.db")


def test_root_serves_something(config: Config) -> None:
    with TestClient(create_app(config)) as client:
        assert client.get("/").status_code == 200
