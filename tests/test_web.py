from pathlib import Path

from fastapi.testclient import TestClient

import hitl_agent
from hitl_agent.api.main import app

# No lifespan context on purpose: skips the MCP client startup.
client = TestClient(app)
WEB = Path(hitl_agent.__file__).parent / "web"


def test_root_serves_ui():
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "HITL Agent" in r.text
    assert "ChatEase" not in r.text


def test_docs_still_served():
    assert client.get("/docs").status_code == 200


def test_astream_route_not_shadowed():
    # 422 proves the route exists and the static mount does not answer for it.
    assert client.post("/api/v1/astream", json={}).status_code == 422


def test_static_assets_served():
    for path in ("/styles.css", "/app.js"):
        assert client.get(path).status_code == 200


def test_ui_never_uses_inner_html():
    assert "innerHTML" not in (WEB / "app.js").read_text()
