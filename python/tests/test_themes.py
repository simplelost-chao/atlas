from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import NodeType, NodeStatus
from industry_analysis.themes.loader import load_themes

def test_load_themes(tmp_path):
    store = GraphStore(tmp_path / "g.db")
    n = load_themes(store, "seeds/ark_themes_2026.yaml")
    assert n == 13
    robotics = store.get_node("robotics")
    assert robotics.node_type == NodeType.theme
    assert robotics.status == NodeStatus.confirmed
    assert robotics.theme_ids == ["robotics"]
