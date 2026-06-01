"""Filing evidence retrieval for expand prompt grounding.

Queries datasource.db (FTS5 + mentions) to find real supply-chain evidence
for a given node, then formats it for injection into the expand prompt.

Strategy:
- Nodes are supply-chain concepts (materials, equipment, sub-industries),
  NOT company names. FTS5 search naturally resolves concept → companies
  because it returns filer_name (the company that mentioned the concept).
- We search across all node aliases to maximise recall for short/technical
  terms (e.g. "InP" alone is noisy, but "InP" + "磷化铟" together are good).
- Evidence IDs (E1, E2, ...) are injected inline and the LLM is required
  to cite them in sources[]. Post-parse validation downgrades any candidate
  whose sources don't reference real injected IDs.
"""
from dataclasses import dataclass


@dataclass
class Evidence:
    id: str          # "E1", "E2", ...
    filer_name: str
    section_path: str
    snippet: str
    source_grade: str = "C"  # filing search hits are C-grade by default


def gather_evidence(
    node_names: list[str],
    datasource_db,
    limit_per_alias: int = 3,
    max_total: int = 8,
) -> list[Evidence]:
    """Search datasource FTS5 for each node alias and collect unique snippets.

    Uses FTS5 trigram search which handles Chinese + English substring matching.
    Results are deduped by (filer_name, section_path) to avoid redundancy.
    """
    if datasource_db is None:
        return []

    seen: set[tuple[str, str]] = set()
    evidence: list[Evidence] = []

    for name in node_names:
        name = name.strip()
        if not name or len(name) < 2:
            continue
        try:
            results = datasource_db.search(name, limit=limit_per_alias)
        except Exception:
            continue
        for r in results:
            key = (r.filer_name or "", r.section_path or "")
            if key in seen:
                continue
            seen.add(key)
            evidence.append(Evidence(
                id=f"E{len(evidence) + 1}",
                filer_name=r.filer_name or "unknown",
                section_path=r.section_path or "",
                snippet=(r.snippet or "").strip(),
            ))
            if len(evidence) >= max_total:
                return evidence

    return evidence


def format_evidence_block(evidence: list[Evidence]) -> str:
    """Format evidence list into a structured block for prompt injection.

    Format:
        [E1] filer: CATL | section: 主要供应商/采购
        ...公司采购了XX材料，主要供应商包括...

        [E2] filer: NVIDIA | section: Item 1. Business
        ...relies on TSMC for advanced node manufacturing...
    """
    if not evidence:
        return ""

    lines = []
    for e in evidence:
        lines.append(f"[{e.id}] 来源: {e.filer_name} | 章节: {e.section_path}")
        if e.snippet:
            lines.append(f"    {e.snippet}")
        lines.append("")
    return "\n".join(lines).rstrip()
