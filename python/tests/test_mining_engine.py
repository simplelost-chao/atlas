import pytest
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType, NodeStatus
from industry_analysis.mining.engine import expand

class FakeClient:
    def __init__(self, out): self.out = out
    def run(self, agent, prompt): return self.out

@pytest.fixture
def store(tmp_path):
    s = GraphStore(tmp_path / "g.db")
    s.upsert_node(Node(id="ai", name_cn="AI", name_en="AI", node_type=NodeType.theme,
                       theme_ids=["ai"], status=NodeStatus.confirmed, description=""))
    return s

_OUT = '{"children":[{"name_cn":"芯片","name_en":"Chip","aliases":["IC"],"node_type":"sub_industry","description":"d","evidence_grade":"A"}]}'

def test_expand_creates_proposed_child_and_edge(store):
    res = expand(store, FakeClient(_OUT), "ai")
    assert res["created"] == 1
    child = store.find_by_name("Chip")
    assert child.status == NodeStatus.proposed
    assert child.theme_ids == ["ai"]            # inherits parent theme
    assert {n.id for n in store.suppliers("ai")} == {child.id}

def test_expand_is_idempotent(store):
    expand(store, FakeClient(_OUT), "ai")
    res2 = expand(store, FakeClient(_OUT), "ai")   # same output again
    assert res2["created"] == 0 and res2["skipped"] == 1
    assert len(store.suppliers("ai")) == 1

def test_existing_node_in_other_theme_gets_linked_not_duplicated(store):
    # pre-existing chip under a different theme
    store.upsert_node(Node(id="chip", name_cn="芯片", name_en="Chip", node_type=NodeType.sub_industry,
                           theme_ids=["robot"], status=NodeStatus.confirmed, description=""))
    res = expand(store, FakeClient(_OUT), "ai")
    assert res["linked"] == 1 and res["created"] == 0
    assert set(store.get_node("chip").theme_ids) == {"robot", "ai"}   # now a chokepoint

def test_auto_confirm_grade(store):
    res = expand(store, FakeClient(_OUT), "ai", auto_confirm_grade="A")
    assert store.find_by_name("Chip").status == NodeStatus.confirmed

def test_intra_batch_duplicates_collapse(store):
    # one batch returns the SAME entity twice (same name) — must create only one node
    out = ('{"children":[{"name_cn":"芯片","name_en":"Chip","node_type":"sub_industry","description":"d"},'
           '{"name_cn":"芯片","name_en":"Chip","node_type":"sub_industry","description":"dup"}]}')
    res = expand(store, FakeClient(out), "ai")
    assert res["created"] == 1
    assert res["skipped"] == 1
    assert len(store.suppliers("ai")) == 1

def test_batch_expand_two_levels(store):
    # level1: ai -> 芯片 ; level2: 芯片 -> 晶圆
    # chip's prompt contains BOTH "芯片" and "AI" (AI is in its downstream path),
    # so check the more specific key first.
    outs = [
        ("芯片", '{"children":[{"name_cn":"晶圆","name_en":"Wafer","node_type":"material","description":"d","evidence_grade":"C"}]}'),
        ("AI", '{"children":[{"name_cn":"芯片","name_en":"Chip","node_type":"sub_industry","description":"d","evidence_grade":"C"}]}'),
    ]
    class Router:
        def run(self, agent, prompt):
            for k, v in outs:
                if k in prompt:
                    return v
            return '{"children":[]}'
    from industry_analysis.mining.engine import batch_expand
    res = batch_expand(store, Router(), "ai", depth=2)
    assert store.find_by_name("Wafer") is not None
    assert res["levels"] == 2
