"""PR4: Tests for Python graph → Atlas Postgres sync.

Uses a real SQLite store + a mock psycopg2 connection to validate
the sync logic without needing a real Postgres instance.
"""
import json
import pytest
from unittest.mock import MagicMock, patch, call
from pathlib import Path
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType, NodeStatus, EvidenceGrade
from industry_analysis.themes.loader import load_themes
from industry_analysis.mining.engine import expand
from industry_analysis.review.queue import approve
from industry_analysis.sync.atlas_sync import sync_to_postgres, SyncResult, _node_type_to_prisma


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def store_with_confirmed(tmp_path):
    store = GraphStore(tmp_path / "graph.db")
    seeds = Path(__file__).parent.parent / "seeds" / "ark_themes_2026.yaml"
    load_themes(store, str(seeds))

    # Add a few confirmed nodes manually (bypass QuantAgent)
    store.upsert_node(Node(
        id="inp-substrate", name_cn="磷化铟衬底", name_en="InP Substrate",
        node_type=NodeType.material, theme_ids=["ai-infrastructure"],
        evidence_grade=EvidenceGrade.B, status=NodeStatus.confirmed,
    ))
    store.upsert_node(Node(
        id="hbm", name_cn="高带宽内存", name_en="HBM",
        aliases=["HBM2E", "HBM3"], node_type=NodeType.component,
        theme_ids=["ai-infrastructure", "robotics"],
        evidence_grade=EvidenceGrade.A, status=NodeStatus.confirmed,
    ))
    store.upsert_node(Node(
        id="inp-proposed", name_cn="待审核节点", name_en="Proposed Node",
        node_type=NodeType.component, theme_ids=["ai-infrastructure"],
        status=NodeStatus.proposed,  # NOT confirmed — should not be synced
    ))
    store.add_edge("inp-substrate", "ai-infrastructure", "InP is upstream of AI infra")
    return store


# ── Unit tests for helper functions ──────────────────────────────────────────

class TestNodeTypeMapping:
    def test_material_maps_to_upstream(self):
        assert _node_type_to_prisma("material") == "UPSTREAM"

    def test_component_maps_to_midstream(self):
        assert _node_type_to_prisma("component") == "MIDSTREAM"

    def test_unknown_defaults_to_midstream(self):
        assert _node_type_to_prisma("unknown_type") == "MIDSTREAM"


# ── Sync tests with mock psycopg2 ────────────────────────────────────────────

class TestSyncToPostgres:
    def _make_mock_conn(self, existing_rows=None):
        """Build a mock psycopg2 connection that returns specified existing rows."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = lambda s: s
        mock_cursor.__exit__ = MagicMock(return_value=False)

        # fetchone() returns None by default (no existing node), or given rows
        fetch_iter = iter(existing_rows or [])
        mock_cursor.fetchone.side_effect = lambda: next(fetch_iter, None)

        mock_conn = MagicMock()
        mock_conn.__enter__ = lambda s: s
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cursor
        return mock_conn, mock_cursor

    def test_dry_run_returns_zero_counts(self, store_with_confirmed):
        result = sync_to_postgres(
            store_with_confirmed, "postgresql://test/db",
            chain_id="chain-1", dry_run=True,
        )
        assert result.nodes_upserted == 0
        assert result.nodes_skipped == 0

    def test_only_confirmed_nodes_synced(self, store_with_confirmed):
        mock_conn, mock_cursor = self._make_mock_conn()
        with patch("psycopg2.connect", return_value=mock_conn):
            result = sync_to_postgres(
                store_with_confirmed, "postgresql://test/db", chain_id="chain-1"
            )
        # inp-proposed (proposed status) should NOT be synced
        # Only inp-substrate and hbm (confirmed)
        # Theme nodes are also excluded
        assert result.nodes_upserted == 2

    def test_normkey_dedup_skips_existing_node(self, store_with_confirmed):
        # Simulate that HBM already exists in Postgres
        mock_conn, mock_cursor = self._make_mock_conn(
            existing_rows=[None, ("existing-pg-id",)]  # first lookup None, second HBM found
        )
        with patch("psycopg2.connect", return_value=mock_conn):
            result = sync_to_postgres(
                store_with_confirmed, "postgresql://test/db", chain_id="chain-1"
            )
        assert result.nodes_upserted == 1   # inp-substrate new
        assert result.nodes_skipped == 1    # hbm already exists

    def test_theme_filter_restricts_sync(self, store_with_confirmed):
        mock_conn, mock_cursor = self._make_mock_conn()
        with patch("psycopg2.connect", return_value=mock_conn):
            result = sync_to_postgres(
                store_with_confirmed, "postgresql://test/db",
                chain_id="chain-1", theme_filter="robotics",
            )
        # Only HBM belongs to robotics theme
        assert result.nodes_upserted == 1

    def test_idempotent_second_run(self, store_with_confirmed):
        # Second run: both nodes already exist → nodes_skipped=2, nodes_upserted=0
        mock_conn, mock_cursor = self._make_mock_conn(
            existing_rows=[("id-1",), ("id-2",)]
        )
        with patch("psycopg2.connect", return_value=mock_conn):
            result = sync_to_postgres(
                store_with_confirmed, "postgresql://test/db", chain_id="chain-1"
            )
        assert result.nodes_upserted == 0
        assert result.nodes_skipped == 2

    def test_evidence_grade_stored_correctly(self, store_with_confirmed):
        mock_conn, mock_cursor = self._make_mock_conn()
        inserted_rows = []

        original_execute = mock_cursor.execute.side_effect
        def capture_execute(sql, params=None):
            if params and "PYTHON_CLI" in str(params):
                inserted_rows.append(params)
        mock_cursor.execute.side_effect = capture_execute

        with patch("psycopg2.connect", return_value=mock_conn):
            sync_to_postgres(
                store_with_confirmed, "postgresql://test/db", chain_id="chain-1"
            )

        # Verify evidence grades were passed in the INSERT calls
        # params order: id,chainId,parentId,name,desc,nodeType,level,order,
        #               aliases,normKey,syncStatus,syncSource,evidenceGrade,...
        grades_inserted = [p[12] for p in inserted_rows if len(p) > 12]
        assert "B" in grades_inserted or "A" in grades_inserted
