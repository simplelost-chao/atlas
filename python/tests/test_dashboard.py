from fastapi.testclient import TestClient
from industry_analysis.dashboard.app import create_app
from industry_analysis.graph.store import GraphStore
from industry_analysis.themes.loader import load_themes


def test_graph_endpoint(tmp_path):
    db = tmp_path / "g.db"
    load_themes(GraphStore(db), "seeds/ark_themes_2026.yaml")
    client = TestClient(create_app(db_path=db))
    r = client.get("/api/graph")
    assert r.status_code == 200
    assert len(r.json()["nodes"]) == 13


def test_node_detail_404(tmp_path):
    client = TestClient(create_app(db_path=tmp_path / "g.db"))
    assert client.get("/api/node/nope").status_code == 404
