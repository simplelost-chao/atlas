"""Incremental update mining: re-score existing nodes (C) + expand leaf nodes (A).

C branch: detect new/modified documents → re-extract → re-score nodes (up and down)
A branch: find upstream leaf nodes (suppliers=[]) → expand one level
"""
from __future__ import annotations

import sqlite3
import time
from contextlib import closing
from dataclasses import dataclass, field

from ..datasource.cn_extract import CnExtractor, EXTRACTOR_VERSION
from ..graph.models import EvidenceGrade, NodeStatus, NodeType
from ..graph.store import GraphStore
from ..mining.engine import expand
from .state import _load_keywords


@dataclass
class UpdateResult:
    theme_ids: list[str] = field(default_factory=list)
    docs_rescored: int = 0
    nodes_grade_upgraded: int = 0
    nodes_grade_downgraded: int = 0
    leaf_nodes_expanded: int = 0
    new_nodes_created: int = 0
    review_queue_added: int = 0
    elapsed_s: float = 0.0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"更新摘要 (themes={','.join(self.theme_ids)})\n"
            f"  新年报重评: {self.docs_rescored} 文档 "
            f"({self.nodes_grade_upgraded} 升 / "
            f"{self.nodes_grade_downgraded} 降 → review queue)\n"
            f"  叶节点展开: {self.leaf_nodes_expanded} 个 "
            f"→ {self.new_nodes_created} 新节点\n"
            f"  进入 review queue: {self.review_queue_added}"
        )


def mine_update(store: GraphStore, client, datasource,
                cn_db_path: str, theme_ids: list[str] | None = None,
                extractor_version: str = EXTRACTOR_VERSION) -> UpdateResult:
    """Run incremental update mining (A+C) for given themes."""
    t0 = time.time()
    result = UpdateResult()

    if theme_ids is None:
        theme_ids = [
            n.id for n in store.list_nodes()
            if n.node_type == NodeType.theme
            and n.id not in {"bitcoin", "tokenized-assets", "defi"}
        ]
    result.theme_ids = list(theme_ids)

    extractor = CnExtractor(cn_db_path, datasource, extractor_version)

    from ..config import get_settings
    cfg = get_settings()

    for theme_id in theme_ids:
        # ── C branch: re-extract new docs, re-score affected nodes ──
        keywords = _load_keywords(theme_id)
        if keywords:
            try:
                _run_c_branch(store, extractor, datasource, theme_id, result)
            except Exception as e:
                result.errors.append(f"C-branch {theme_id}: {e}")

        # ── A branch: expand upstream leaf nodes ──
        try:
            _run_a_branch(store, client, datasource, theme_id,
                          cfg.auto_confirm_grade, result)
        except Exception as e:
            result.errors.append(f"A-branch {theme_id}: {e}")

    result.elapsed_s = time.time() - t0
    return result


def _run_c_branch(store: GraphStore, extractor: CnExtractor,
                  datasource, theme_id: str,
                  result: UpdateResult) -> None:
    """Detect new/modified docs, re-extract, re-score nodes."""
    with closing(sqlite3.connect(
        f"file:{extractor.cn_db_path}?mode=ro", uri=True
    )) as cn_conn:
        cn_conn.row_factory = sqlite3.Row
        new_docs = datasource.get_unextracted_docs(
            cn_conn, extractor.version,
            doc_types=("annual", "semi-annual"),
        )

    if not new_docs:
        return

    for doc in new_docs:
        symbol = doc["symbol"]
        try:
            extractor.extract_by_symbol(symbol)
            result.docs_rescored += 1
        except Exception as e:
            result.errors.append(f"extract {symbol}: {e}")
            continue

        # Re-score nodes whose name or aliases match this symbol
        theme_nodes = [
            n for n in store.list_nodes()
            if theme_id in n.theme_ids
            and n.node_type != NodeType.theme
            and (symbol.lower() in (n.name_cn or "").lower()
                 or symbol.lower() in (n.name_en or "").lower()
                 or any(symbol.lower() in a.lower() for a in n.aliases))
        ]
        for node in theme_nodes:
            _rescore_node(store, datasource, node, result)


def _rescore_node(store: GraphStore, datasource, node, result: UpdateResult):
    """Re-evaluate evidence_grade for a node based on current FTS hits."""
    # Search by primary name first, then aliases
    hits = datasource.search(node.name_cn or node.name_en or node.id, limit=5)
    if not hits:
        for alias in node.aliases[:3]:
            hits = datasource.search(alias, limit=2)
            if hits:
                break

    old_grade = node.evidence_grade
    if hits:
        if old_grade in (None, EvidenceGrade.E, EvidenceGrade.D):
            store.upsert_node(node.model_copy(
                update={"evidence_grade": EvidenceGrade.C}))
            result.nodes_grade_upgraded += 1
    else:
        if old_grade in (EvidenceGrade.A, EvidenceGrade.B):
            new_grade = (EvidenceGrade.B if old_grade == EvidenceGrade.A
                         else EvidenceGrade.C)
            store.upsert_node(node.model_copy(
                update={"evidence_grade": new_grade,
                        "status": NodeStatus.proposed}))
            result.nodes_grade_downgraded += 1
            result.review_queue_added += 1


def _run_a_branch(store: GraphStore, client, datasource, theme_id: str,
                  auto_confirm_grade, result: UpdateResult) -> None:
    """Expand upstream leaf nodes (no suppliers, good evidence) for a theme."""
    _GOOD_GRADES = {EvidenceGrade.A, EvidenceGrade.B, EvidenceGrade.C}
    leaf_nodes = [
        n for n in store.list_nodes()
        if theme_id in n.theme_ids
        and n.node_type != NodeType.theme
        and n.status == NodeStatus.confirmed
        and n.evidence_grade in _GOOD_GRADES
        and len(store.suppliers(n.id)) == 0
    ]

    grade_order = {EvidenceGrade.A: 0, EvidenceGrade.B: 1, EvidenceGrade.C: 2}
    leaf_nodes.sort(key=lambda n: grade_order.get(n.evidence_grade, 9))

    for node in leaf_nodes:
        try:
            r = expand(store, client, node.id,
                       auto_confirm_grade=auto_confirm_grade,
                       datasource_db=datasource)
            result.leaf_nodes_expanded += 1
            result.new_nodes_created += r.get("created", 0)
            result.review_queue_added += r.get("created", 0)
        except Exception as e:
            result.errors.append(f"expand {node.id}: {e}")
