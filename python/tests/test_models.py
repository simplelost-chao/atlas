from industry_analysis.graph.models import Node, NodeType, NodeStatus, normalize

def test_node_defaults():
    n = Node(id="inp", name_cn="磷化铟", name_en="InP", node_type=NodeType.material, description="衬底")
    assert n.status == NodeStatus.proposed
    assert n.aliases == []
    assert n.theme_ids == []

def test_normalize_collapses_variants():
    assert normalize(" InP ") == normalize("inp") == "inp"
    assert normalize("Indium Phosphide") == "indiumphosphide"
