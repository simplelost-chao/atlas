import re
from industry_analysis.graph.models import EvidenceGrade, Node, NodeStatus, NodeType, normalize
from industry_analysis.mining.prompt import build_expand_prompt
from industry_analysis.mining.schema import parse_candidates
from industry_analysis.mining.evidence_context import gather_evidence, format_evidence_block

_GRADES = ["A", "B", "C", "D", "E"]
_STRUCTURAL = {NodeType.sub_industry, NodeType.module, NodeType.component}


def _slug(name_en: str, name_cn: str) -> str:
    base = normalize(name_en) or normalize(name_cn)
    return re.sub(r"[^0-9a-z一-鿿]", "", base)[:48] or "node"


def _grade_ok(grade: str | None, threshold: str | None) -> bool:
    if threshold is None or grade is None:
        return False
    return _GRADES.index(grade) <= _GRADES.index(threshold)


def expand(store, client, node_id: str, agent: str = "chain-miner",
           auto_confirm_grade=None, datasource_db=None) -> dict:
    node = store.get_node(node_id)
    if node is None:
        raise ValueError(f"node not found: {node_id}")

    existing = store.suppliers(node_id)
    existing_keys = {normalize(x) for n in existing for x in n.all_names()}

    # Gather filing evidence for this node (if datasource available)
    evidence = gather_evidence(node.all_names(), datasource_db)
    evidence_block = format_evidence_block(evidence)
    # Only validate citations when evidence was actually injected.
    # None → skip validation entirely (no datasource); set → enforce citations.
    valid_ids: set[str] | None = {e.id for e in evidence} if evidence else None

    prompt = build_expand_prompt(
        node, store.path_to_root(node_id),
        [n.name_cn for n in existing],
        evidence_block=evidence_block,
    )
    batch = parse_candidates(client.run(agent, prompt), valid_ids)

    created = linked = skipped = 0
    for c in batch.children:
        names = [c.name_cn, c.name_en, *c.aliases]
        if any(normalize(x) in existing_keys for x in names):
            skipped += 1
            continue
        match = next(filter(None, (store.find_by_name(x) for x in names)), None)
        if match:                                  # cross-theme link
            store.add_edge(match.id, node_id, c.relation_rationale)
            for t in node.theme_ids:
                store.add_theme_to_node(match.id, t)
            store.log("link", match.id, f"under {node_id}")
            linked += 1
        else:
            nid = _slug(c.name_en, c.name_cn)
            while store.get_node(nid):
                nid += "_x"
            confirm = _grade_ok(c.evidence_grade, auto_confirm_grade) and c.node_type in {t.value for t in _STRUCTURAL}
            store.upsert_node(Node(
                id=nid, name_cn=c.name_cn, name_en=c.name_en, aliases=c.aliases,
                node_type=NodeType(c.node_type), bottleneck_layer=c.bottleneck_layer,
                theme_ids=list(node.theme_ids), description=c.description,
                evidence_grade=c.evidence_grade, evidence_md="",
                status=NodeStatus.confirmed if confirm else NodeStatus.proposed,
            ))
            store.add_edge(nid, node_id, c.relation_rationale)
            store.log("propose", nid, f"under {node_id}")
            created += 1
            existing_keys.update(normalize(x) for x in names)
    return {"created": created, "linked": linked, "skipped": skipped}


def batch_expand(store, client, node_id: str, depth: int = 1, agent="chain-miner",
                 auto_confirm_grade=None, datasource_db=None) -> dict:
    frontier, totals = [node_id], {"created": 0, "linked": 0, "skipped": 0, "levels": 0}
    for _ in range(depth):
        if not frontier:
            break
        next_frontier = []
        for nid in frontier:
            before = {n.id for n in store.suppliers(nid)}
            r = expand(store, client, nid, agent=agent,
                       auto_confirm_grade=auto_confirm_grade, datasource_db=datasource_db)
            for k in ("created", "linked", "skipped"):
                totals[k] += r[k]
            next_frontier += [n.id for n in store.suppliers(nid) if n.id not in before]
        frontier = next_frontier
        totals["levels"] += 1
    return totals
