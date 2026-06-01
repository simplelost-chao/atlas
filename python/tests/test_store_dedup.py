import pytest
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType

@pytest.fixture
def store(tmp_path):
    s = GraphStore(tmp_path / "g.db")
    s.upsert_node(Node(id="inp", name_cn="磷化铟", name_en="InP",
                       aliases=["Indium Phosphide"], node_type=NodeType.material,
                       theme_ids=["ai"], description=""))
    return s

def test_find_by_any_name(store):
    assert store.find_by_name("inp").id == "inp"
    assert store.find_by_name(" Indium  Phosphide ").id == "inp"
    assert store.find_by_name("磷化铟").id == "inp"
    assert store.find_by_name("germanium") is None

def test_add_theme_unions(store):
    store.add_theme_to_node("inp", "defense")
    assert set(store.get_node("inp").theme_ids) == {"ai", "defense"}
