"""Theme state machine for ia mine first / update routing."""
from enum import Enum
from pathlib import Path

from ..graph.models import NodeType
from ..graph.store import GraphStore


class ThemeState(str, Enum):
    UNMINED = "unmined"   # no non-theme nodes at all
    SHALLOW = "shallow"   # has nodes but < 5 depth-1 children
    MINED = "mined"       # >= 5 depth-1 children
    STALE = "stale"       # mined but marked for refresh (future use)


def get_theme_state(store: GraphStore, theme_id: str) -> ThemeState:
    """Return the mining state for a theme node."""
    theme = store.get_node(theme_id)
    if theme is None:
        raise ValueError(f"Theme '{theme_id}' not found in graph")

    non_theme_nodes = [
        n for n in store.list_nodes()
        if theme_id in n.theme_ids and n.node_type != NodeType.theme
    ]
    if not non_theme_nodes:
        return ThemeState.UNMINED

    depth1 = store.suppliers(theme_id)
    if len(depth1) < 5:
        return ThemeState.SHALLOW

    return ThemeState.MINED


def _load_keywords(theme_id: str) -> list[str]:
    """Load theme keywords from seeds/theme_keywords.yaml."""
    import yaml
    seeds = Path(__file__).parents[3] / "seeds" / "theme_keywords.yaml"
    if not seeds.exists():
        return []
    data = yaml.safe_load(seeds.read_text(encoding="utf-8"))
    return data.get(theme_id, [])
