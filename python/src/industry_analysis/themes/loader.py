import yaml
from industry_analysis.graph.models import Node, NodeStatus, NodeType


def load_themes(store, seed_path: str) -> int:
    data = yaml.safe_load(open(seed_path, encoding="utf-8"))
    for t in data["themes"]:
        store.upsert_node(Node(
            id=t["id"], name_cn=t["name_cn"], name_en=t["name_en"],
            node_type=NodeType.theme, theme_ids=[t["id"]],
            status=NodeStatus.confirmed, description=t.get("description", ""),
        ))
    return len(data["themes"])
