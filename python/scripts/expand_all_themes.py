"""Batch-expand all ARK 2026 themes to build the foundation graph.

Usage:
    python scripts/expand_all_themes.py [--dry-run]

Strategy:
- Hardware / supply-chain themes → depth 3
- Software / AI themes           → depth 2
- Crypto / finance themes        → skip (no physical supply chain)
- For already-started themes: find unexpanded leaf nodes and expand them
"""
import argparse
import sys
import time

sys.path.insert(0, "src")

from industry_analysis.config import get_settings
from industry_analysis.datasource.store.datasource_db import DataSourceDB
from industry_analysis.graph.models import NodeStatus, NodeType
from industry_analysis.graph.store import GraphStore
from industry_analysis.mining.engine import expand
from industry_analysis.quantagent.client import QuantAgentClient

HARDWARE_THEMES = [
    "robotics",
    "ai-infrastructure",
    "autonomous-vehicles",
    "autonomous-logistics",
    "reusable-rockets",
    "distributed-energy",
]
SOFTWARE_THEMES = [
    "ai-consumer-os",
    "ai-productivity",
    "great-acceleration",
    "multiomics",
]
SKIP_THEMES = {"bitcoin", "tokenized-assets", "defi"}

THEME_DEPTH = {t: 3 for t in HARDWARE_THEMES}
THEME_DEPTH.update({t: 2 for t in SOFTWARE_THEMES})


def leaf_nodes(store: GraphStore, theme_id: str, max_depth: int) -> list:
    """Return nodes in this theme that have no upstream suppliers yet."""
    all_nodes = [
        n for n in store.list_nodes()
        if theme_id in n.theme_ids and n.node_type != NodeType.theme
        and n.status == NodeStatus.confirmed
    ]
    return [n for n in all_nodes if len(store.suppliers(n.id)) == 0]


def expand_theme(store, client, ds, theme_id: str, target_depth: int, dry_run: bool):
    theme = store.get_node(theme_id)
    if not theme:
        print(f"  [SKIP] {theme_id} not found in graph")
        return

    total_nodes = len([n for n in store.list_nodes() if theme_id in n.theme_ids
                       and n.node_type != NodeType.theme])
    print(f"\n{'='*60}")
    print(f"Theme: {theme.name_cn} ({theme_id})  existing={total_nodes}  target_depth={target_depth}")
    print(f"{'='*60}")

    if dry_run:
        leaves = leaf_nodes(store, theme_id, target_depth)
        print(f"  [dry-run] Would expand theme root + {len(leaves)} leaf nodes")
        return

    # Step 1: expand from theme root (gets depth-1 nodes)
    print(f"  [depth 1] expanding {theme_id}...")
    t0 = time.time()
    r = expand(store, client, theme_id, auto_confirm_grade=cfg.auto_confirm_grade,
               datasource_db=ds)
    print(f"  => created={r['created']} linked={r['linked']} skipped={r['skipped']}  ({time.time()-t0:.0f}s)")

    if target_depth < 2:
        return

    # Step 2+: iteratively expand leaf nodes up to target_depth
    for depth in range(2, target_depth + 1):
        leaves = leaf_nodes(store, theme_id, target_depth)
        if not leaves:
            print(f"  [depth {depth}] no leaf nodes to expand — done")
            break
        print(f"  [depth {depth}] expanding {len(leaves)} leaf nodes...")
        created_total = 0
        for n in leaves:
            t0 = time.time()
            try:
                r = expand(store, client, n.id, auto_confirm_grade=cfg.auto_confirm_grade,
                           datasource_db=ds)
                created_total += r['created']
                status = f"created={r['created']} linked={r['linked']} skipped={r['skipped']}"
            except Exception as e:
                status = f"ERROR: {e}"
            print(f"    {n.name_cn[:30]:<30} {status}  ({time.time()-t0:.0f}s)")
        print(f"  [depth {depth}] total new nodes: {created_total}")
        if created_total == 0:
            break


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--themes", nargs="*", help="Only expand these theme IDs")
    args = parser.parse_args()

    global cfg
    cfg = get_settings()
    store = GraphStore(str(cfg.db_path or (cfg.data_root / "graph" / "graph.db")))
    client = QuantAgentClient(cfg.quantagent_cli, cfg.node_path,
                              cfg.quantagent_agents_dir, cfg.quantagent_timeout)
    ds_path = cfg.datasource_db_path or (cfg.data_root / "datasource" / "datasource.db")
    ds = DataSourceDB(str(ds_path))

    themes_to_run = args.themes or (HARDWARE_THEMES + SOFTWARE_THEMES)
    themes_to_run = [t for t in themes_to_run if t not in SKIP_THEMES]

    print(f"Expanding {len(themes_to_run)} themes  dry_run={args.dry_run}")
    print(f"Themes: {themes_to_run}")

    t_start = time.time()
    for theme_id in themes_to_run:
        depth = THEME_DEPTH.get(theme_id, 2)
        expand_theme(store, client, ds, theme_id, depth, args.dry_run)

    elapsed = time.time() - t_start
    total = len([n for n in store.list_nodes() if n.node_type != NodeType.theme])
    print(f"\n{'='*60}")
    print(f"Done in {elapsed/60:.1f} min.  Total non-theme nodes: {total}")


if __name__ == "__main__":
    main()
