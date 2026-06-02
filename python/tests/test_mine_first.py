import pytest
from unittest.mock import MagicMock, patch
from industry_analysis.graph.models import Node, NodeType, NodeStatus, EvidenceGrade
from industry_analysis.graph.store import GraphStore
from industry_analysis.mine.first import mine_first, FirstMineResult


@pytest.fixture
def store(tmp_path):
    s = GraphStore(str(tmp_path / "graph.db"))
    s.upsert_node(Node(id="robotics", name_cn="机器人", name_en="Robotics",
                       node_type=NodeType.theme, theme_ids=["robotics"],
                       status=NodeStatus.confirmed))
    return s


def _mock_extractor(sections=3):
    m = MagicMock()
    from industry_analysis.datasource.cn_extract import ExtractResult
    m.extract_by_theme.return_value = ExtractResult(
        docs_processed=2, sections_indexed=sections)
    m.extract_by_symbol.return_value = ExtractResult(
        docs_processed=1, sections_indexed=sections)
    m.ds = MagicMock()  # mock the datasource attribute too
    return m


def test_mine_first_raises_if_already_mined(store):
    for i in range(5):
        n = Node(id=f"nd{i}", name_cn=f"节点{i}", name_en=f"Node{i}",
                 node_type=NodeType.material, theme_ids=["robotics"],
                 status=NodeStatus.confirmed)
        store.upsert_node(n)
        store.add_edge(n.id, "robotics", "")
    extractor = _mock_extractor()
    with pytest.raises(ValueError, match="already mined"):
        mine_first(store, MagicMock(), extractor, "robotics",
                   depth=3, timeout=30)


def test_mine_first_calls_cn_extract_before_expand(store):
    extractor = _mock_extractor()
    with patch("industry_analysis.mine.first.batch_expand") as mock_expand:
        mock_expand.return_value = {"created": 0, "linked": 0, "skipped": 0}
        with patch("industry_analysis.mine.first._load_keywords",
                   return_value=["谐波减速器"]):
            result = mine_first(store, MagicMock(), extractor, "robotics",
                                depth=3, timeout=120)
    extractor.extract_by_theme.assert_called_once()
    assert isinstance(result, FirstMineResult)


def test_mine_first_returns_result_with_created_count(store):
    extractor = _mock_extractor()
    with patch("industry_analysis.mine.first.batch_expand") as mock_expand:
        mock_expand.return_value = {"created": 5, "linked": 1, "skipped": 0}
        with patch("industry_analysis.mine.first._load_keywords",
                   return_value=["谐波减速器"]):
            result = mine_first(store, MagicMock(), extractor, "robotics",
                                depth=3, timeout=120)
    assert result.theme_id == "robotics"
    assert result.nodes_created == 5
    assert result.nodes_linked == 1
    assert result.extract_sections == 3  # from mock_extractor(sections=3)
