import pytest
from industry_analysis.graph.models import Node, NodeType, NodeStatus
from industry_analysis.graph.store import GraphStore
from industry_analysis.mine.state import ThemeState, get_theme_state


@pytest.fixture
def store(tmp_path):
    return GraphStore(str(tmp_path / "graph.db"))


def _theme(id: str) -> Node:
    return Node(id=id, name_cn=id, name_en=id,
                node_type=NodeType.theme, theme_ids=[id],
                status=NodeStatus.confirmed)


def _node(id: str, theme_id: str,
          node_type: NodeType = NodeType.material) -> Node:
    return Node(id=id, name_cn=id, name_en=id,
                node_type=node_type, theme_ids=[theme_id],
                status=NodeStatus.confirmed)


def test_unmined_when_no_nodes(store):
    store.upsert_node(_theme("robotics"))
    assert get_theme_state(store, "robotics") == ThemeState.UNMINED


def test_shallow_when_fewer_than_5_depth1(store):
    store.upsert_node(_theme("robotics"))
    for i in range(3):
        n = _node(f"node{i}", "robotics")
        store.upsert_node(n)
        store.add_edge(n.id, "robotics", "")
    assert get_theme_state(store, "robotics") == ThemeState.SHALLOW


def test_mined_when_5_or_more_depth1(store):
    store.upsert_node(_theme("robotics"))
    for i in range(5):
        n = _node(f"node{i}", "robotics")
        store.upsert_node(n)
        store.add_edge(n.id, "robotics", "")
    assert get_theme_state(store, "robotics") == ThemeState.MINED


def test_unmined_theme_not_in_graph_raises(store):
    with pytest.raises(ValueError, match="Theme 'missing' not found"):
        get_theme_state(store, "missing")
