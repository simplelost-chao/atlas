"""Orchestrate first-time deep mining for a theme."""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from ..datasource.cn_extract import CnExtractor
from ..graph.models import EvidenceGrade, NodeType
from ..mining.engine import batch_expand
from .state import ThemeState, _load_keywords, get_theme_state


@dataclass
class FirstMineResult:
    theme_id: str
    extract_sections: int = 0
    nodes_created: int = 0
    nodes_linked: int = 0
    elapsed_s: float = 0.0
    errors: list[str] = field(default_factory=list)


def mine_first(store, client, extractor: CnExtractor, theme_id: str,
               depth: int = 3, timeout: int = 120) -> FirstMineResult:
    """Run first-time deep mining for a theme.

    Raises:
        ValueError: if theme is already in MINED state
    """
    state = get_theme_state(store, theme_id)
    if state == ThemeState.MINED:
        raise ValueError(
            f"Theme '{theme_id}' is already mined. Use 'mine update' instead."
        )

    t0 = time.time()
    result = FirstMineResult(theme_id=theme_id)

    # Step 1: pre-fill evidence from CN filings
    keywords = _load_keywords(theme_id)
    if keywords:
        extract_result = extractor.extract_by_theme(keywords)
        result.extract_sections = extract_result.sections_indexed
        result.errors.extend(extract_result.errors)

    # Step 2: deep expand
    from ..config import get_settings
    cfg = get_settings()
    expand_result = batch_expand(
        store, client, theme_id, depth=depth,
        auto_confirm_grade=cfg.auto_confirm_grade,
        datasource_db=extractor.ds,
    )
    result.nodes_created = expand_result.get("created", 0)
    result.nodes_linked = expand_result.get("linked", 0)

    # Step 3: fetch evidence for company nodes discovered during expand
    company_nodes = [
        n for n in store.list_nodes()
        if theme_id in n.theme_ids
        and n.node_type == NodeType.company
        and n.evidence_grade in (None, EvidenceGrade.E, EvidenceGrade.D)
    ]
    for node in company_nodes:
        ticker = next((a for a in node.aliases if "." in a), None)
        if ticker:
            try:
                r = extractor.extract_by_symbol(ticker)
                result.extract_sections += r.sections_indexed
            except Exception as e:
                result.errors.append(f"company fetch {ticker}: {e}")

    result.elapsed_s = time.time() - t0
    return result
