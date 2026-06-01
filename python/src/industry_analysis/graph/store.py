import json
import sqlite3
from pathlib import Path

from .models import Edge, Node, NodeStatus, NodeType, normalize


class CycleError(Exception):
    pass


class GraphStore:
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self._init_schema()

    def _init_schema(self):
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY, name_cn TEXT, name_en TEXT, aliases TEXT,
                node_type TEXT, bottleneck_layer TEXT, theme_ids TEXT,
                description TEXT, status TEXT, evidence_grade TEXT, evidence_md TEXT,
                metadata TEXT, created_at TEXT, updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS edges (
                upstream_id TEXT, downstream_id TEXT, relation TEXT, rationale TEXT,
                PRIMARY KEY (upstream_id, downstream_id),
                FOREIGN KEY (upstream_id) REFERENCES nodes(id),
                FOREIGN KEY (downstream_id) REFERENCES nodes(id)
            );
            CREATE TABLE IF NOT EXISTS review_log (
                ts TEXT, action TEXT, node_id TEXT, detail TEXT
            );
            """
        )
        self.conn.commit()

    # ---- nodes ----
    def upsert_node(self, node: Node):
        self.conn.execute(
            """INSERT INTO nodes VALUES (:id,:name_cn,:name_en,:aliases,:node_type,
               :bottleneck_layer,:theme_ids,:description,:status,:evidence_grade,
               :evidence_md,:metadata,:created_at,:updated_at)
               ON CONFLICT(id) DO UPDATE SET
                 name_cn=excluded.name_cn, name_en=excluded.name_en, aliases=excluded.aliases,
                 node_type=excluded.node_type, bottleneck_layer=excluded.bottleneck_layer,
                 theme_ids=excluded.theme_ids, description=excluded.description,
                 status=excluded.status, evidence_grade=excluded.evidence_grade,
                 evidence_md=excluded.evidence_md, metadata=excluded.metadata,
                 updated_at=excluded.updated_at""",
            self._to_row(node),
        )
        self.conn.commit()

    def _to_row(self, n: Node) -> dict:
        d = n.model_dump()
        d["node_type"] = n.node_type.value
        d["bottleneck_layer"] = n.bottleneck_layer.value if n.bottleneck_layer else None
        d["status"] = n.status.value
        d["evidence_grade"] = n.evidence_grade.value if n.evidence_grade else None
        d["aliases"] = json.dumps(n.aliases, ensure_ascii=False)
        d["theme_ids"] = json.dumps(n.theme_ids, ensure_ascii=False)
        d["metadata"] = json.dumps(n.metadata, ensure_ascii=False)
        return d

    def _from_row(self, r: sqlite3.Row) -> Node:
        return Node(
            id=r["id"], name_cn=r["name_cn"], name_en=r["name_en"],
            aliases=json.loads(r["aliases"]), node_type=r["node_type"],
            bottleneck_layer=r["bottleneck_layer"], theme_ids=json.loads(r["theme_ids"]),
            description=r["description"], status=r["status"],
            evidence_grade=r["evidence_grade"], evidence_md=r["evidence_md"] or "",
            metadata=json.loads(r["metadata"]), created_at=r["created_at"], updated_at=r["updated_at"],
        )

    def get_node(self, node_id: str) -> Node | None:
        r = self.conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        return self._from_row(r) if r else None

    def list_nodes(self, status=None, node_type=None, theme_id=None) -> list[Node]:
        rows = self.conn.execute("SELECT * FROM nodes").fetchall()
        out = [self._from_row(r) for r in rows]
        if status:
            out = [n for n in out if n.status == status]
        if node_type:
            out = [n for n in out if n.node_type == node_type]
        if theme_id:
            out = [n for n in out if theme_id in n.theme_ids]
        return out

    def set_status(self, node_id: str, status: NodeStatus):
        self.conn.execute("UPDATE nodes SET status=? WHERE id=?", (status.value, node_id))
        self.conn.commit()

    def log(self, action: str, node_id: str, detail: str = ""):
        from .models import _now
        self.conn.execute("INSERT INTO review_log VALUES (?,?,?,?)", (_now(), action, node_id, detail))
        self.conn.commit()

    # ---- edges ----
    def _reachable(self, start: str, target: str) -> bool:
        """True if target is reachable from start following upstream->downstream edges."""
        seen, stack = set(), [start]
        while stack:
            cur = stack.pop()
            if cur == target:
                return True
            if cur in seen:
                continue
            seen.add(cur)
            for r in self.conn.execute("SELECT downstream_id FROM edges WHERE upstream_id=?", (cur,)):
                stack.append(r["downstream_id"])
        return False

    def add_edge(self, upstream_id: str, downstream_id: str, rationale: str = ""):
        if upstream_id == downstream_id or self._reachable(downstream_id, upstream_id):
            raise CycleError(f"{upstream_id}->{downstream_id} would create a cycle")
        self.conn.execute(
            "INSERT OR IGNORE INTO edges VALUES (?,?,?,?)",
            (upstream_id, downstream_id, "upstream_of", rationale),
        )
        self.conn.commit()

    def suppliers(self, node_id: str) -> list[Node]:
        rows = self.conn.execute("SELECT upstream_id FROM edges WHERE downstream_id=?", (node_id,)).fetchall()
        return [self.get_node(r["upstream_id"]) for r in rows]

    def consumers(self, node_id: str) -> list[Node]:
        rows = self.conn.execute("SELECT downstream_id FROM edges WHERE upstream_id=?", (node_id,)).fetchall()
        return [self.get_node(r["downstream_id"]) for r in rows]

    def remove_edges_for(self, node_id: str):
        """Delete all edges where node_id is upstream or downstream."""
        self.conn.execute("DELETE FROM edges WHERE upstream_id=? OR downstream_id=?", (node_id, node_id))
        self.conn.commit()

    def path_to_root(self, node_id: str) -> list[Node]:
        """Walk downstream (consumers) until a theme node; returns [node, ..., theme]."""
        path, cur, seen = [], self.get_node(node_id), set()
        while cur and cur.id not in seen:
            path.append(cur)
            seen.add(cur.id)
            if cur.node_type == NodeType.theme:
                break
            cons = self.consumers(cur.id)
            cur = cons[0] if cons else None
        return path

    # ---- dedup / entity resolution ----
    def find_by_name(self, name: str) -> Node | None:
        key = normalize(name)
        if not key:
            return None
        for n in self.list_nodes():
            if any(normalize(x) == key for x in n.all_names()):
                return n
        return None

    def add_theme_to_node(self, node_id: str, theme_id: str):
        n = self.get_node(node_id)
        if n and theme_id not in n.theme_ids:
            n.theme_ids.append(theme_id)
            self.upsert_node(n)

    # ---- analysis / export ----
    def chokepoints(self, min_themes: int = 2) -> list[Node]:
        return [n for n in self.list_nodes()
                if n.node_type != NodeType.theme and len(n.theme_ids) >= min_themes]

    def all_edges(self) -> list[Edge]:
        rows = self.conn.execute("SELECT * FROM edges").fetchall()
        return [Edge(upstream_id=r["upstream_id"], downstream_id=r["downstream_id"],
                     relation=r["relation"], rationale=r["rationale"]) for r in rows]

    def export(self) -> dict:
        return {
            "nodes": [n.model_dump(mode="json") for n in self.list_nodes()],
            "edges": [e.model_dump() for e in self.all_edges()],
        }
