import pytest
from industry_analysis.graph.store import GraphStore, CycleError
from industry_analysis.graph.models import Node, NodeType

@pytest.fixture
def store(tmp_path):
    s = GraphStore(tmp_path / "g.db")
    # ai is the theme root; chip/wafer are upstream so path_to_root stops only at ai
    types = {"ai": NodeType.theme, "chip": NodeType.sub_industry, "wafer": NodeType.material}
    for i, t in types.items():
        s.upsert_node(Node(id=i, name_cn=i, name_en=i, node_type=t, theme_ids=["ai"], description=""))
    return s

def test_add_edge_and_traverse(store):
    store.add_edge("chip", "ai", "AI needs chips")   # chip upstream of ai
    store.add_edge("wafer", "chip", "chips need wafers")
    assert {n.id for n in store.suppliers("ai")} == {"chip"}
    assert {n.id for n in store.suppliers("chip")} == {"wafer"}
    assert [n.id for n in store.path_to_root("wafer")] == ["wafer", "chip", "ai"]

def test_cycle_rejected(store):
    store.add_edge("chip", "ai", "")
    store.add_edge("wafer", "chip", "")
    with pytest.raises(CycleError):
        store.add_edge("ai", "wafer", "")   # would close ai->wafer->chip->ai
