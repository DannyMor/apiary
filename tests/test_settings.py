from fastapi.testclient import TestClient

from apiary.api import create_app
from apiary.config import Config


def test_settings_merge_and_null_deletes(config: Config) -> None:
    with TestClient(create_app(config)) as client:
        assert client.get("/api/settings").json() == {}
        first = client.put("/api/settings", json={"world": "#f4f6f8", "threshold": 35}).json()
        assert first == {"world": "#f4f6f8", "threshold": 35}
        second = client.put("/api/settings", json={"threshold": 40, "collapsed": {"repo:a": True}}).json()
        assert second == {"world": "#f4f6f8", "threshold": 40, "collapsed": {"repo:a": True}}
        assert client.get("/api/settings").json() == second
        assert "world" not in client.put("/api/settings", json={"world": None}).json()
