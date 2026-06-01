"""PR1: End-to-end CLI verification tests.

These tests use a fake QuantAgent client to verify the full
theme load → expand → review pipeline without network calls.
"""
import json
import pytest
from pathlib import Path
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import NodeStatus, NodeType
from industry_analysis.mining.engine import expand
from industry_analysis.themes.loader import load_themes
from industry_analysis.review.queue import approve, reject, pending


_FAKE_EXPAND_RESPONSE = json.dumps({"children": [
    {
        "name_cn": "AI芯片",
        "name_en": "AI Accelerator",
        "aliases": ["GPU", "NPU"],
        "node_type": "sub_industry",
        "bottleneck_layer": "工艺设备层",
        "description": "用于AI训练和推理的专用加速芯片",
        "evidence_grade": "A",
        "relation_rationale": "AI基础设施的核心计算组件",
        "sources": [],
    },
    {
        "name_cn": "高速互连",
        "name_en": "High-Speed Interconnect",
        "aliases": ["NVLink", "InfiniBand"],
        "node_type": "component",
        "bottleneck_layer": "技术物理层",
        "description": "GPU间高带宽低延迟互连",
        "evidence_grade": "B",
        "relation_rationale": "大规模训练集群的扩展瓶颈",
        "sources": [],
    },
    {
        "name_cn": "高带宽内存",
        "name_en": "HBM",
        "aliases": ["HBM2E", "HBM3"],
        "node_type": "component",
        "bottleneck_layer": "材料前驱体层",
        "description": "AI加速器的高带宽内存组件",
        "evidence_grade": "A",
        "relation_rationale": "内存带宽是大模型推理的核心瓶颈",
        "sources": [],
    },
]})


class FakeQuantAgent:
    def run(self, agent: str, prompt: str) -> str:
        return _FAKE_EXPAND_RESPONSE


@pytest.fixture
def tmp_store(tmp_path):
    return GraphStore(tmp_path / "graph.db")


@pytest.fixture
def store_with_themes(tmp_store):
    seeds = Path(__file__).parent.parent / "seeds" / "ark_themes_2026.yaml"
    load_themes(tmp_store, str(seeds))
    return tmp_store


class TestThemeLoad:
    def test_loads_13_ark_themes(self, tmp_store):
        seeds = Path(__file__).parent.parent / "seeds" / "ark_themes_2026.yaml"
        count = load_themes(tmp_store, str(seeds))
        assert count == 13

    def test_themes_are_theme_node_type(self, store_with_themes):
        themes = store_with_themes.list_nodes(node_type=NodeType.theme)
        assert len(themes) == 13
        assert all(n.node_type == NodeType.theme for n in themes)

    def test_ai_infrastructure_theme_exists(self, store_with_themes):
        node = store_with_themes.get_node("ai-infrastructure")
        assert node is not None
        assert node.name_en == "AI Infrastructure"


class TestExpand:
    def test_expand_creates_upstream_nodes(self, store_with_themes):
        client = FakeQuantAgent()
        result = expand(store_with_themes, client, "ai-infrastructure")
        assert result["created"] == 3
        assert result["skipped"] == 0

    def test_expanded_nodes_are_proposed(self, store_with_themes):
        expand(store_with_themes, FakeQuantAgent(), "ai-infrastructure")
        proposed = store_with_themes.list_nodes(status=NodeStatus.proposed)
        assert len(proposed) == 3

    def test_expanded_nodes_inherit_theme(self, store_with_themes):
        expand(store_with_themes, FakeQuantAgent(), "ai-infrastructure")
        proposed = store_with_themes.list_nodes(status=NodeStatus.proposed)
        for node in proposed:
            assert "ai-infrastructure" in node.theme_ids

    def test_idempotent_second_expand_skips_existing(self, store_with_themes):
        expand(store_with_themes, FakeQuantAgent(), "ai-infrastructure")
        result2 = expand(store_with_themes, FakeQuantAgent(), "ai-infrastructure")
        # All 3 should be skipped on second run
        assert result2["skipped"] == 3
        assert result2["created"] == 0

    def test_cross_theme_link_on_duplicate_name(self, store_with_themes):
        # Load a second theme and expand it with an overlapping node name
        expand(store_with_themes, FakeQuantAgent(), "ai-infrastructure")

        # Now expand robotics with same "HBM" name — should link not duplicate
        class FakeRoboticsResponse:
            def run(self, agent, prompt):
                return json.dumps({"children": [{
                    "name_cn": "高带宽内存", "name_en": "HBM",
                    "aliases": ["HBM2E"],
                    "node_type": "component", "bottleneck_layer": None,
                    "description": "机器人控制器内存",
                    "evidence_grade": "C", "relation_rationale": "robotics memory",
                    "sources": [],
                }]})

        result = expand(store_with_themes, FakeRoboticsResponse(), "robotics")
        assert result["linked"] == 1
        assert result["created"] == 0

        # HBM node should now belong to both themes
        hbm = store_with_themes.get_node("hbm")
        assert "ai-infrastructure" in hbm.theme_ids
        assert "robotics" in hbm.theme_ids


class TestReview:
    def test_pending_returns_proposed_nodes(self, store_with_themes):
        expand(store_with_themes, FakeQuantAgent(), "ai-infrastructure")
        p = pending(store_with_themes)
        assert len(p) == 3

    def test_approve_sets_confirmed(self, store_with_themes):
        expand(store_with_themes, FakeQuantAgent(), "ai-infrastructure")
        nodes = pending(store_with_themes)
        approve(store_with_themes, nodes[0].id)
        assert store_with_themes.get_node(nodes[0].id).status == NodeStatus.confirmed

    def test_reject_removes_from_pending(self, store_with_themes):
        expand(store_with_themes, FakeQuantAgent(), "ai-infrastructure")
        nodes = pending(store_with_themes)
        reject(store_with_themes, nodes[0].id)
        remaining = pending(store_with_themes)
        assert len(remaining) == 2

    def test_auto_confirm_grade_threshold(self, store_with_themes):
        # Grade A nodes should auto-confirm when threshold is "A"
        expand(store_with_themes, FakeQuantAgent(), "ai-infrastructure",
               auto_confirm_grade="A")
        # Only non-theme confirmed nodes (theme nodes are pre-loaded as confirmed)
        confirmed_non_theme = [
            n for n in store_with_themes.list_nodes(status=NodeStatus.confirmed)
            if n.node_type != NodeType.theme
        ]
        # AI芯片 (A) and HBM (A) auto-confirm; 高速互连 (B) stays proposed
        assert len(confirmed_non_theme) == 2
        assert len(pending(store_with_themes)) == 1


class TestChokepoints:
    def test_chokepoints_finds_multi_theme_nodes(self, store_with_themes):
        # Expand ai-infrastructure
        expand(store_with_themes, FakeQuantAgent(), "ai-infrastructure")

        # Approve all
        for n in pending(store_with_themes):
            approve(store_with_themes, n.id)

        # Expand robotics with HBM overlap (see cross-theme test above)
        class FakeOverlap:
            def run(self, agent, prompt):
                return json.dumps({"children": [{
                    "name_cn": "高带宽内存", "name_en": "HBM", "aliases": ["HBM2E"],
                    "node_type": "component", "bottleneck_layer": None,
                    "description": "d", "evidence_grade": "C",
                    "relation_rationale": "r", "sources": [],
                }]})

        expand(store_with_themes, FakeOverlap(), "robotics")

        cps = store_with_themes.chokepoints(min_themes=2)
        assert any(n.name_en == "HBM" for n in cps)
