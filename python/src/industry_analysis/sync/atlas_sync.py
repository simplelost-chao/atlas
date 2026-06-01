"""Sync confirmed Python CLI nodes into Atlas Postgres.

One-way only: Python graph.db → Postgres. Never reads from Postgres to
update graph.db. Re-running is safe (idempotent via normKey upsert).

Requires: psycopg2-binary  (pip install psycopg2-binary)

Schema assumptions (from PR3 migration):
  ChainNode has: syncStatus, syncSource, evidenceGrade, bottleneckLayer,
                 themeIds, normKey, aliases
  ChainEdge has: upstreamId, downstreamId, rationale, chainId, syncSource
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Optional

from industry_analysis.graph.models import Node, NodeStatus, normalize
from industry_analysis.graph.store import GraphStore


@dataclass
class SyncResult:
    nodes_upserted: int = 0
    nodes_skipped: int = 0    # already exists with same normKey
    edges_upserted: int = 0
    edges_skipped: int = 0
    errors: list[str] = field(default_factory=list)


def _cuid_like() -> str:
    """Generate a cuid-like random ID (not cryptographic, just unique)."""
    return "c" + uuid.uuid4().hex[:24]


def _node_type_to_prisma(node_type: str) -> str:
    """Map Python NodeType to Prisma NodeType enum."""
    mapping = {
        "theme": "UPSTREAM",
        "sub_industry": "UPSTREAM",
        "module": "MIDSTREAM",
        "component": "MIDSTREAM",
        "material": "UPSTREAM",
        "precursor": "UPSTREAM",
        "equipment": "UPSTREAM",
        "company": "DOWNSTREAM",
    }
    return mapping.get(node_type, "MIDSTREAM")


def sync_to_postgres(
    store: GraphStore,
    db_url: str,
    chain_id: str,
    dry_run: bool = False,
    theme_filter: Optional[str] = None,
) -> SyncResult:
    """Sync confirmed nodes from graph.db into Atlas Postgres ChainNode/ChainEdge.

    Args:
        store: Python GraphStore (SQLite source)
        db_url: Postgres connection URL (e.g. postgresql://user:pass@host/db)
        chain_id: Atlas IndustryChain.id to attach nodes to
        dry_run: If True, print what would be done but don't write
        theme_filter: Only sync nodes with this theme_id (optional)

    Returns:
        SyncResult with counts and any errors.
    """
    result = SyncResult()

    # Load confirmed nodes from Python SQLite
    from industry_analysis.graph.models import NodeType
    nodes = store.list_nodes(status=NodeStatus.confirmed)
    if theme_filter:
        nodes = [n for n in nodes if theme_filter in n.theme_ids]
    # Exclude theme-type root nodes (they're not meaningful ChainNodes)
    nodes = [n for n in nodes if n.node_type != NodeType.theme]

    if dry_run:
        print(f"[dry-run] Would sync {len(nodes)} confirmed non-theme nodes to chain {chain_id}")
        edges = store.all_edges()
        node_ids = {n.id for n in nodes}
        relevant_edges = [e for e in edges if e.upstream_id in node_ids and e.downstream_id in node_ids]
        print(f"[dry-run] Would sync {len(relevant_edges)} edges")
        return result

    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        raise ImportError("psycopg2-binary not installed. Run: pip install psycopg2-binary")

    conn = psycopg2.connect(db_url)
    try:
        with conn:
            with conn.cursor() as cur:
                # Build a map: Python node ID → Postgres ChainNode ID
                # Uses normKey for dedup: if a node with same normKey already
                # exists in this chain, we reuse its ID instead of creating a dupe.
                py_to_pg: dict[str, str] = {}

                for node in nodes:
                    nk = normalize(node.name_en) or normalize(node.name_cn)

                    # Check if normKey already exists in this chain
                    cur.execute(
                        'SELECT id FROM "ChainNode" WHERE "chainId"=%s AND "normKey"=%s LIMIT 1',
                        (chain_id, nk),
                    )
                    existing = cur.fetchone()

                    if existing:
                        pg_id = existing[0]
                        # Update sync metadata in case evidence grade improved
                        cur.execute(
                            '''UPDATE "ChainNode" SET
                               "syncStatus"=%s, "evidenceGrade"=%s,
                               "bottleneckLayer"=%s, "themeIds"=%s,
                               "aliases"=%s, "updatedAt"=NOW()
                               WHERE id=%s''',
                            (
                                "CONFIRMED",
                                node.evidence_grade.value if node.evidence_grade else None,
                                node.bottleneck_layer.value if node.bottleneck_layer else None,
                                node.theme_ids,
                                list(node.all_names()),
                                pg_id,
                            ),
                        )
                        py_to_pg[node.id] = pg_id
                        result.nodes_skipped += 1
                    else:
                        pg_id = _cuid_like()
                        cur.execute(
                            '''INSERT INTO "ChainNode"
                               (id, "chainId", "parentId", name, description,
                                "nodeType", level, "order",
                                aliases, "normKey",
                                "syncStatus", "syncSource",
                                "evidenceGrade", "bottleneckLayer", "themeIds",
                                "keyDrivers", "createdAt", "updatedAt")
                               VALUES (%s,%s,%s,%s,%s, %s,%s,%s, %s,%s, %s,%s, %s,%s,%s, %s,NOW(),NOW())
                               ON CONFLICT (id) DO NOTHING''',
                            (
                                pg_id,
                                chain_id,
                                None,  # parentId: Python DAG uses ChainEdge not parentId
                                node.name_cn,
                                node.description,
                                _node_type_to_prisma(node.node_type.value),
                                0,  # level — edges convey structure, not level
                                0,
                                list(node.all_names()),
                                nk,
                                "CONFIRMED",
                                "PYTHON_CLI",
                                node.evidence_grade.value if node.evidence_grade else None,
                                node.bottleneck_layer.value if node.bottleneck_layer else None,
                                node.theme_ids,
                                [],
                            ),
                        )
                        py_to_pg[node.id] = pg_id
                        result.nodes_upserted += 1

                # Sync edges — only between nodes we just synced
                node_ids = {n.id for n in nodes}
                for edge in store.all_edges():
                    if edge.upstream_id not in node_ids or edge.downstream_id not in node_ids:
                        continue
                    up_pg = py_to_pg.get(edge.upstream_id)
                    dn_pg = py_to_pg.get(edge.downstream_id)
                    if not up_pg or not dn_pg:
                        continue

                    cur.execute(
                        '''INSERT INTO "ChainEdge"
                           (id, "upstreamId", "downstreamId", rationale, "chainId",
                            "syncSource", "createdAt")
                           VALUES (%s,%s,%s,%s,%s,'PYTHON_CLI',NOW())
                           ON CONFLICT ("upstreamId","downstreamId","chainId") DO NOTHING''',
                        (_cuid_like(), up_pg, dn_pg, edge.rationale, chain_id),
                    )
                    if conn.cursor().rowcount == 0:
                        result.edges_skipped += 1
                    else:
                        result.edges_upserted += 1

    finally:
        conn.close()

    return result
