from industry_analysis.graph.models import NodeStatus, NodeType


def pending(store):
    return store.list_nodes(status=NodeStatus.proposed)


def approve(store, node_id: str):
    store.set_status(node_id, NodeStatus.confirmed)
    store.log("approve", node_id)


def reject(store, node_id: str):
    store.set_status(node_id, NodeStatus.rejected)
    store.log("reject", node_id)


def merge(store, node_id: str, into: str):
    """Fold node_id into `into`: move its edges, add its names as aliases, reject the source."""
    if node_id == into:
        raise ValueError("cannot merge a node into itself")
    src, dst = store.get_node(node_id), store.get_node(into)
    if not src or not dst:
        raise ValueError("merge needs two existing nodes")
    for sup in store.suppliers(node_id):
        try:
            store.add_edge(sup.id, into, "merged")
        except Exception:
            pass
    for con in store.consumers(node_id):
        try:
            store.add_edge(into, con.id, "merged")
        except Exception:
            pass
    for nm in src.all_names():
        if nm not in dst.aliases and nm not in (dst.name_cn, dst.name_en):
            dst.aliases.append(nm)
    for t in src.theme_ids:
        if t not in dst.theme_ids:
            dst.theme_ids.append(t)
    store.upsert_node(dst)
    store.remove_edges_for(node_id)
    store.set_status(node_id, NodeStatus.rejected)
    store.log("merge", node_id, f"into {into}")


def approve_bulk(store, node_type: NodeType | None = None, theme_id: str | None = None) -> int:
    n = 0
    for node in pending(store):
        if node_type and node.node_type != node_type:
            continue
        if theme_id and theme_id not in node.theme_ids:
            continue
        approve(store, node.id)
        n += 1
    return n
