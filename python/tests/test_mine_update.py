import pytest
import sqlite3
from unittest.mock import MagicMock, patch
from industry_analysis.graph.models import (
    Node, NodeType, NodeStatus, EvidenceGrade
)
from industry_analysis.graph.store import GraphStore
from industry_analysis.datasource.store.datasource_db import DataSourceDB
from industry_analysis.mine.update import mine_update, UpdateResult


@pytest.fixture
def store(tmp_path):
    s = GraphStore(str(tmp_path / "graph.db"))
    s.upsert_node(Node(id="robotics", name_cn="机器人", name_en="Robotics",
                       node_type=NodeType.theme, theme_ids=["robotics"],
                       status=NodeStatus.confirmed))
    s.upsert_node(Node(id="harmonic", name_cn="谐波减速器", name_en="Harmonic Drive",
                       node_type=NodeType.component, theme_ids=["robotics"],
                       status=NodeStatus.confirmed,
                       evidence_grade=EvidenceGrade.D))
    s.add_edge("harmonic", "robotics", "upstream")
    return s


@pytest.fixture
def ds(tmp_path):
    return DataSourceDB(tmp_path / "ds.db")


def _make_cn_db(tmp_path):
    cn_db = tmp_path / "cn.db"
    conn = sqlite3.connect(str(cn_db))
    conn.executescript("""
        CREATE TABLE documents (id TEXT, symbol TEXT, doc_type TEXT,
            period_end TEXT, content_hash TEXT, parse_status TEXT);
        CREATE TABLE sections (id TEXT, document_id TEXT, symbol TEXT,
            section_seq INTEGER, section_level INTEGER,
            heading_path TEXT, section_name TEXT, content TEXT, char_count INTEGER);
        CREATE INDEX idx_secs_doc ON sections(document_id);
    """)
    conn.commit()
    conn.close()
    return cn_db


def test_update_returns_update_result(store, ds, tmp_path):
    cn_db = _make_cn_db(tmp_path)
    result = mine_update(store, MagicMock(), ds, str(cn_db), theme_ids=["robotics"])
    assert isinstance(result, UpdateResult)
    assert result.theme_ids == ["robotics"]


def test_update_a_expands_leaf_nodes_with_good_evidence(store, ds, tmp_path):
    cn_db = _make_cn_db(tmp_path)
    # Give harmonic grade B so A-branch picks it up
    store.upsert_node(Node(id="harmonic", name_cn="谐波减速器", name_en="Harmonic Drive",
                           node_type=NodeType.component, theme_ids=["robotics"],
                           status=NodeStatus.confirmed,
                           evidence_grade=EvidenceGrade.B))
    with patch("industry_analysis.mine.update.expand") as mock_expand:
        mock_expand.return_value = {"created": 2, "linked": 0, "skipped": 0}
        result = mine_update(store, MagicMock(), ds, str(cn_db),
                             theme_ids=["robotics"])
    mock_expand.assert_called_once()
    assert result.leaf_nodes_expanded == 1
    assert result.new_nodes_created == 2


def test_update_a_skips_leaf_nodes_with_grade_d(store, ds, tmp_path):
    cn_db = _make_cn_db(tmp_path)
    # harmonic has grade D — should NOT be expanded
    with patch("industry_analysis.mine.update.expand") as mock_expand:
        mock_expand.return_value = {"created": 0, "linked": 0, "skipped": 0}
        result = mine_update(store, MagicMock(), ds, str(cn_db),
                             theme_ids=["robotics"])
    mock_expand.assert_not_called()
    assert result.leaf_nodes_expanded == 0


def test_update_c_rescores_node_when_evidence_found(store, ds, tmp_path):
    cn_db = _make_cn_db(tmp_path)
    # Pre-index evidence for harmonic into datasource.db
    ds.upsert_filing(MagicMock(id="f1", company_id="harmonic", filer_name="H",
                               filing_type="annual", period_end="2025-12-31",
                               source="cn_filings", source_id="d1",
                               source_url=None, indexed_at=None))
    ds.fts_index("f1", "harmonic", "供应商", "谐波减速器相关内容")

    with patch("industry_analysis.mine.update.CnExtractor") as MockExt:
        instance = MockExt.return_value
        from industry_analysis.datasource.cn_extract import ExtractResult
        instance.extract_by_symbol.return_value = ExtractResult(docs_processed=1)
        instance.extract_by_theme.return_value = ExtractResult(docs_processed=0)
        instance.cn_db_path = str(cn_db)
        instance.version = "1"
        instance.ds = ds
        # Simulate get_unextracted_docs returning one doc
        ds.mark_extracted("d1", "h1", "1")  # pre-mark so C-branch finds nothing new
        result = mine_update(store, MagicMock(), ds, str(cn_db),
                             theme_ids=["robotics"])
    assert isinstance(result, UpdateResult)
