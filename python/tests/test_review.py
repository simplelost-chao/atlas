import pytest
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType, NodeStatus
from industry_analysis.review import queue

@pytest.fixture
def store(tmp_path):
    s = GraphStore(tmp_path / "g.db")
    s.upsert_node(Node(id="ai", name_cn="AI", name_en="AI", node_type=NodeType.theme,
                       theme_ids=["ai"], status=NodeStatus.confirmed, description=""))
    for i, t in (("chip", NodeType.sub_industry), ("ic", NodeType.sub_industry)):
        s.upsert_node(Node(id=i, name_cn=i, name_en=i, node_type=t, theme_ids=["ai"], description=""))
        s.add_edge(i, "ai", "")
    return s

def test_approve_reject(store):
    queue.approve(store, "chip")
    assert store.get_node("chip").status == NodeStatus.confirmed
    queue.reject(store, "ic")
    assert store.get_node("ic").status == NodeStatus.rejected

def test_pending_list(store):
    assert {n.id for n in queue.pending(store)} == {"chip", "ic"}

def test_merge_moves_edges_and_aliases(store):
    # ic is a duplicate of chip: merge ic into chip
    queue.merge(store, "ic", into="chip")
    assert store.get_node("ic").status == NodeStatus.rejected
    assert "ic" in [a for a in store.get_node("chip").aliases]
    # ic's downstream edge (ic->ai) now exists as chip->ai (already did) and ic has none dangling
    assert {n.id for n in store.suppliers("ai")} == {"chip"}

def test_bulk_approve_by_type(store):
    n = queue.approve_bulk(store, node_type=NodeType.sub_industry)
    assert n == 2
    assert all(x.status == NodeStatus.confirmed for x in (store.get_node("chip"), store.get_node("ic")))

def test_merge_into_self_rejected(store):
    with pytest.raises(ValueError):
        queue.merge(store, "chip", into="chip")
    # graph must be untouched: chip still confirmed-or-proposed, edge intact
    assert store.get_node("chip").status != NodeStatus.rejected
    assert {n.id for n in store.suppliers("ai")} == {"chip", "ic"}
