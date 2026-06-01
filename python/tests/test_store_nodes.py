import pytest
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType, NodeStatus

@pytest.fixture
def store(tmp_path):
    return GraphStore(tmp_path / "g.db")

def _node(id, **kw):
    base = dict(id=id, name_cn=id, name_en=id, node_type=NodeType.sub_industry, description="")
    base.update(kw)
    return Node(**base)

def test_upsert_get_roundtrip(store):
    store.upsert_node(_node("ai", node_type=NodeType.theme, theme_ids=["ai"], aliases=["AI"]))
    got = store.get_node("ai")
    assert got.name_cn == "ai"
    assert got.aliases == ["AI"]
    assert got.theme_ids == ["ai"]

def test_list_filter_by_status(store):
    store.upsert_node(_node("a", status=NodeStatus.confirmed))
    store.upsert_node(_node("b", status=NodeStatus.proposed))
    ids = {n.id for n in store.list_nodes(status=NodeStatus.proposed)}
    assert ids == {"b"}

def test_set_status(store):
    store.upsert_node(_node("a"))
    store.set_status("a", NodeStatus.confirmed)
    assert store.get_node("a").status == NodeStatus.confirmed
