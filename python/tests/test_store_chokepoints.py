import pytest
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType, NodeStatus

@pytest.fixture
def store(tmp_path):
    s = GraphStore(tmp_path / "g.db")
    s.upsert_node(Node(id="inp", name_cn="InP", name_en="InP", node_type=NodeType.material,
                       theme_ids=["ai", "defense"], status=NodeStatus.confirmed, description=""))
    s.upsert_node(Node(id="srv", name_cn="server", name_en="server", node_type=NodeType.sub_industry,
                       theme_ids=["ai"], status=NodeStatus.confirmed, description=""))
    return s

def test_chokepoints_need_two_themes(store):
    cps = store.chokepoints(min_themes=2)
    assert [n.id for n in cps] == ["inp"]

def test_export_shape(store):
    store.add_edge("inp", "srv", "")
    g = store.export()
    assert {n["id"] for n in g["nodes"]} == {"inp", "srv"}
    assert g["edges"][0]["upstream_id"] == "inp"
