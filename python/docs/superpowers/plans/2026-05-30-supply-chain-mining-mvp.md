# Supply-Chain Mining MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build IndustryAnalysis MVP: an ARK-2026-theme-rooted 产业链 DAG that is mined via the QuantAgent CLI, with an `ia` CLI and a Cytoscape.js dashboard.

**Architecture:** Python orchestrator that makes NO LLM calls — all node-expansion reasoning is delegated to the QuantAgent CLI subprocess. SQLite is the single source of truth (nodes/edges/review_log, evidence text in a TEXT column). A typer CLI and a FastAPI+Cytoscape.js dashboard read/write the same `GraphStore`. Cross-theme shared nodes (the chokepoints) emerge from alias-based dedup adding extra `upstream_of` edges.

**Tech Stack:** Python 3.11+, sqlite3 (stdlib), pydantic v2, pydantic-settings, typer, fastapi, uvicorn, pyyaml, loguru, pytest. QuantAgent CLI at `../QuantAgent/dist/cli.js` (node).

**Spec:** `docs/superpowers/specs/2026-05-30-supply-chain-mining-design.md`

---

## File Structure

```
pyproject.toml                              # package + deps + pytest config
.env.example                                # IA_ config template
AGENTS.md                                   # conventions (mirror DailyAnalysis)
seeds/ark_themes_2026.yaml                  # 13 ARK theme root nodes
.quantagent/agents/chain-miner.md           # QuantAgent agent: layer-by-layer mining
src/industry_analysis/
  __init__.py
  config.py                                 # pydantic-settings, env_prefix="IA_"
  graph/
    __init__.py
    models.py                               # enums + Node/Edge pydantic models + normalize()
    store.py                                # GraphStore: schema, CRUD, cycle-check, alias dedup, chokepoints
  quantagent/
    __init__.py
    client.py                               # subprocess wrapper -> QuantAgent CLI
  mining/
    __init__.py
    schema.py                               # CandidateChild/CandidateBatch + parse_candidates()
    prompt.py                               # build_expand_prompt()
    engine.py                               # expand() / batch_expand()
  review/
    __init__.py
    queue.py                                # approve/reject/merge + bulk + auto-confirm
  themes/
    __init__.py
    loader.py                               # load_themes()
  cli/
    __init__.py
    main.py                                 # typer app -> `ia`
  dashboard/
    __init__.py
    app.py                                  # FastAPI
    static/index.html                       # Cytoscape.js single page
tests/
  test_config.py test_models.py test_store_nodes.py test_store_edges.py
  test_store_dedup.py test_store_chokepoints.py test_quantagent_client.py
  test_mining_schema.py test_mining_prompt.py test_mining_engine.py
  test_review.py test_themes.py test_cli.py test_dashboard.py
```

**Edge direction convention (used everywhere):** an edge is `(upstream_id, downstream_id)` meaning *upstream supplies downstream*. Expanding node N produces **upstream suppliers** U; each adds edge `(U, N)`. So `suppliers(N) = {from : edge.to == N}` and `consumers(N) = {to : edge.from == N}`. `path_to_root` walks consumers (downstream) until a `theme` node.

---

## Task 1: Project scaffold + config

**Files:**
- Create: `pyproject.toml`, `src/industry_analysis/__init__.py`, `src/industry_analysis/config.py`, `.env.example`, `tests/test_config.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "industry-analysis"
version = "0.1.0"
description = "Supply-chain (产业链) research and mining: ARK-theme-rooted DAG mined via QuantAgent CLI"
requires-python = ">=3.11"
dependencies = [
    "pydantic>=2.10",
    "pydantic-settings>=2.7",
    "typer>=0.12",
    "fastapi>=0.115",
    "uvicorn>=0.34",
    "pyyaml>=6.0",
    "loguru>=0.7",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "httpx>=0.28"]

[project.scripts]
ia = "industry_analysis.cli.main:app"

[tool.hatch.build.targets.wheel]
packages = ["src/industry_analysis"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

- [ ] **Step 2: Create `src/industry_analysis/__init__.py`** (empty file)

- [ ] **Step 3: Write the failing test** — `tests/test_config.py`

```python
from industry_analysis.config import Settings

def test_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("IA_DB_PATH", str(tmp_path / "g.db"))
    s = Settings()
    assert str(s.db_path).endswith("g.db")
    assert s.dashboard_port == 8300
    assert s.quantagent_cli.endswith("cli.js")
    assert s.auto_confirm_grade is None  # gate on by default
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pytest tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError: industry_analysis.config`

- [ ] **Step 5: Create `src/industry_analysis/config.py`**

```python
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="IA_", env_file=".env", extra="ignore")

    db_path: Path = Path("data/graph.db")
    quantagent_cli: str = "../QuantAgent/dist/cli.js"
    quantagent_agents_dir: str = ".quantagent/agents"
    node_path: str = "node"
    quantagent_timeout: int = 600
    dashboard_port: int = 8300
    # When set (e.g. "B"), structural nodes with grade <= this auto-confirm; None keeps full manual gate.
    auto_confirm_grade: str | None = None


def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest tests/test_config.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml src/industry_analysis/__init__.py src/industry_analysis/config.py .env.example tests/test_config.py
git commit -m "feat: project scaffold + settings"
```

`.env.example` content:
```
IA_DB_PATH=data/graph.db
IA_QUANTAGENT_CLI=../QuantAgent/dist/cli.js
IA_QUANTAGENT_AGENTS_DIR=.quantagent/agents
IA_NODE_PATH=node
IA_DASHBOARD_PORT=8300
# IA_AUTO_CONFIRM_GRADE=B
```

---

## Task 2: Graph models (enums + Node/Edge + normalize)

**Files:**
- Create: `src/industry_analysis/graph/__init__.py` (empty), `src/industry_analysis/graph/models.py`, `tests/test_models.py`

- [ ] **Step 1: Write the failing test** — `tests/test_models.py`

```python
from industry_analysis.graph.models import Node, NodeType, NodeStatus, normalize

def test_node_defaults():
    n = Node(id="inp", name_cn="磷化铟", name_en="InP", node_type=NodeType.material, description="衬底")
    assert n.status == NodeStatus.proposed
    assert n.aliases == []
    assert n.theme_ids == []

def test_normalize_collapses_variants():
    assert normalize(" InP ") == normalize("inp") == "inp"
    assert normalize("Indium Phosphide") == "indiumphosphide"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create `src/industry_analysis/graph/models.py`**

```python
import re
from datetime import datetime, timezone
from enum import Enum
from pydantic import BaseModel, Field


class NodeType(str, Enum):
    theme = "theme"
    sub_industry = "sub_industry"
    module = "module"
    component = "component"
    material = "material"
    precursor = "precursor"
    equipment = "equipment"
    company = "company"


class BottleneckLayer(str, Enum):
    physical = "技术物理层"
    process_equipment = "工艺设备层"
    material_precursor = "材料前驱体层"
    mass_production = "量产生态层"
    capital_market = "资本市场层"


class NodeStatus(str, Enum):
    proposed = "proposed"
    confirmed = "confirmed"
    rejected = "rejected"


class EvidenceGrade(str, Enum):
    A = "A"; B = "B"; C = "C"; D = "D"; E = "E"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize(name: str) -> str:
    """Lowercase, drop all non-alphanumeric (incl. spaces) for alias matching. Keeps CJK."""
    return re.sub(r"[^0-9a-z一-鿿]", "", name.lower())


class Node(BaseModel):
    id: str
    name_cn: str
    name_en: str
    aliases: list[str] = Field(default_factory=list)
    node_type: NodeType
    bottleneck_layer: BottleneckLayer | None = None
    theme_ids: list[str] = Field(default_factory=list)
    description: str = ""
    status: NodeStatus = NodeStatus.proposed
    evidence_grade: EvidenceGrade | None = None
    evidence_md: str = ""
    metadata: dict = Field(default_factory=dict)
    created_at: str = Field(default_factory=_now)
    updated_at: str = Field(default_factory=_now)

    def all_names(self) -> list[str]:
        return [self.name_cn, self.name_en, *self.aliases]


class Edge(BaseModel):
    upstream_id: str
    downstream_id: str
    relation: str = "upstream_of"
    rationale: str = ""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_models.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/graph/__init__.py src/industry_analysis/graph/models.py tests/test_models.py
git commit -m "feat: graph models (Node/Edge/enums/normalize)"
```

---

## Task 3: GraphStore — schema + node CRUD

**Files:**
- Create: `src/industry_analysis/graph/store.py`, `tests/test_store_nodes.py`

- [ ] **Step 1: Write the failing test** — `tests/test_store_nodes.py`

```python
import pytest
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType, NodeStatus

@pytest.fixture
def store(tmp_path):
    return GraphStore(tmp_path / "g.db")

def _node(id, **kw):
    base = dict(id=id, name_cn=id, name_en=id, node_type=NodeType.sub_industry, description="")
    base.update(kw)
    return Node(**base)

def test_upsert_get_roundtrip(store):
    store.upsert_node(_node("ai", node_type=NodeType.theme, theme_ids=["ai"], aliases=["AI"]))
    got = store.get_node("ai")
    assert got.name_cn == "ai"
    assert got.aliases == ["AI"]
    assert got.theme_ids == ["ai"]

def test_list_filter_by_status(store):
    store.upsert_node(_node("a", status=NodeStatus.confirmed))
    store.upsert_node(_node("b", status=NodeStatus.proposed))
    ids = {n.id for n in store.list_nodes(status=NodeStatus.proposed)}
    assert ids == {"b"}

def test_set_status(store):
    store.upsert_node(_node("a"))
    store.set_status("a", NodeStatus.confirmed)
    assert store.get_node("a").status == NodeStatus.confirmed
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_store_nodes.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create `src/industry_analysis/graph/store.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_store_nodes.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/graph/store.py tests/test_store_nodes.py
git commit -m "feat: GraphStore schema + node CRUD"
```

---

## Task 4: GraphStore — edges + cycle detection + traversal

**Files:**
- Modify: `src/industry_analysis/graph/store.py`
- Create: `tests/test_store_edges.py`

- [ ] **Step 1: Write the failing test** — `tests/test_store_edges.py`

```python
import pytest
from industry_analysis.graph.store import GraphStore, CycleError
from industry_analysis.graph.models import Node, NodeType

@pytest.fixture
def store(tmp_path):
    s = GraphStore(tmp_path / "g.db")
    # ai is the theme root; chip/wafer are upstream so path_to_root stops only at ai
    types = {"ai": NodeType.theme, "chip": NodeType.sub_industry, "wafer": NodeType.material}
    for i, t in types.items():
        s.upsert_node(Node(id=i, name_cn=i, name_en=i, node_type=t, theme_ids=["ai"], description=""))
    return s

def test_add_edge_and_traverse(store):
    store.add_edge("chip", "ai", "AI needs chips")   # chip upstream of ai
    store.add_edge("wafer", "chip", "chips need wafers")
    assert {n.id for n in store.suppliers("ai")} == {"chip"}
    assert {n.id for n in store.suppliers("chip")} == {"wafer"}
    assert [n.id for n in store.path_to_root("wafer")] == ["wafer", "chip", "ai"]

def test_cycle_rejected(store):
    store.add_edge("chip", "ai", "")
    store.add_edge("wafer", "chip", "")
    with pytest.raises(CycleError):
        store.add_edge("ai", "wafer", "")   # would close ai->wafer->chip->ai
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_store_edges.py -v`
Expected: FAIL with `AttributeError: 'GraphStore' object has no attribute 'add_edge'`

- [ ] **Step 3: Append edge/traversal methods to `GraphStore` in `store.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_store_edges.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/graph/store.py tests/test_store_edges.py
git commit -m "feat: edges, cycle detection, traversal"
```

---

## Task 5: GraphStore — alias dedup + add_or_link

**Files:**
- Modify: `src/industry_analysis/graph/store.py`
- Create: `tests/test_store_dedup.py`

- [ ] **Step 1: Write the failing test** — `tests/test_store_dedup.py`

```python
import pytest
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType

@pytest.fixture
def store(tmp_path):
    s = GraphStore(tmp_path / "g.db")
    s.upsert_node(Node(id="inp", name_cn="磷化铟", name_en="InP",
                       aliases=["Indium Phosphide"], node_type=NodeType.material,
                       theme_ids=["ai"], description=""))
    return s

def test_find_by_any_name(store):
    assert store.find_by_name("inp").id == "inp"
    assert store.find_by_name(" Indium  Phosphide ").id == "inp"
    assert store.find_by_name("磷化铟").id == "inp"
    assert store.find_by_name("germanium") is None

def test_add_theme_unions(store):
    store.add_theme_to_node("inp", "defense")
    assert set(store.get_node("inp").theme_ids) == {"ai", "defense"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_store_dedup.py -v`
Expected: FAIL with `AttributeError: ... 'find_by_name'`

- [ ] **Step 3: Append dedup methods to `GraphStore` in `store.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_store_dedup.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/graph/store.py tests/test_store_dedup.py
git commit -m "feat: alias-based entity resolution (find_by_name, add_theme)"
```

---

## Task 6: GraphStore — chokepoints + graph export

**Files:**
- Modify: `src/industry_analysis/graph/store.py`
- Create: `tests/test_store_chokepoints.py`

- [ ] **Step 1: Write the failing test** — `tests/test_store_chokepoints.py`

```python
import pytest
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType, NodeStatus

@pytest.fixture
def store(tmp_path):
    s = GraphStore(tmp_path / "g.db")
    s.upsert_node(Node(id="inp", name_cn="InP", name_en="InP", node_type=NodeType.material,
                       theme_ids=["ai", "defense"], status=NodeStatus.confirmed, description=""))
    s.upsert_node(Node(id="srv", name_cn="server", name_en="server", node_type=NodeType.sub_industry,
                       theme_ids=["ai"], status=NodeStatus.confirmed, description=""))
    return s

def test_chokepoints_need_two_themes(store):
    cps = store.chokepoints(min_themes=2)
    assert [n.id for n in cps] == ["inp"]

def test_export_shape(store):
    store.add_edge("inp", "srv", "")
    g = store.export()
    assert {n["id"] for n in g["nodes"]} == {"inp", "srv"}
    assert g["edges"][0]["upstream_id"] == "inp"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_store_chokepoints.py -v`
Expected: FAIL with `AttributeError: ... 'chokepoints'`

- [ ] **Step 3: Append to `GraphStore` in `store.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_store_chokepoints.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/graph/store.py tests/test_store_chokepoints.py
git commit -m "feat: chokepoints query + graph export"
```

---

## Task 7: QuantAgent CLI client

**Files:**
- Create: `src/industry_analysis/quantagent/__init__.py` (empty), `src/industry_analysis/quantagent/client.py`, `tests/test_quantagent_client.py`

- [ ] **Step 1: Write the failing test** — `tests/test_quantagent_client.py`

```python
import subprocess
import pytest
from industry_analysis.quantagent.client import QuantAgentClient, QuantAgentError

class _Done:
    def __init__(self, rc, out="", err=""):
        self.returncode, self.stdout, self.stderr = rc, out, err

def test_run_returns_stdout(monkeypatch):
    captured = {}
    def fake_run(cmd, **kw):
        captured["cmd"] = cmd
        return _Done(0, out='{"children": []}')
    monkeypatch.setattr(subprocess, "run", fake_run)
    c = QuantAgentClient(cli_path="x/cli.js", agents_dir="a", node_path="node")
    assert c.run("chain-miner", "hello") == '{"children": []}'
    assert captured["cmd"][:5] == ["node", "x/cli.js", "--agent", "chain-miner", "--agents-dir"]

def test_nonzero_raises(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kw: _Done(1, err="boom"))
    c = QuantAgentClient(cli_path="x", agents_dir="a")
    with pytest.raises(QuantAgentError, match="boom"):
        c.run("chain-miner", "hi")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_quantagent_client.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create `src/industry_analysis/quantagent/client.py`**

```python
import subprocess


class QuantAgentError(Exception):
    pass


class QuantAgentClient:
    def __init__(self, cli_path: str, agents_dir: str, node_path: str = "node", timeout: int = 600):
        self.cli_path, self.agents_dir, self.node_path, self.timeout = cli_path, agents_dir, node_path, timeout

    def run(self, agent: str, prompt: str) -> str:
        cmd = [self.node_path, self.cli_path, "--agent", agent,
               "--agents-dir", self.agents_dir, "--prompt", prompt]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout)
        if proc.returncode != 0:
            raise QuantAgentError(f"QuantAgent '{agent}' failed (rc={proc.returncode}): {proc.stderr.strip()}")
        return proc.stdout
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_quantagent_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/quantagent/ tests/test_quantagent_client.py
git commit -m "feat: QuantAgent CLI subprocess client"
```

---

## Task 8: Mining candidate schema + parser

**Files:**
- Create: `src/industry_analysis/mining/__init__.py` (empty), `src/industry_analysis/mining/schema.py`, `tests/test_mining_schema.py`

- [ ] **Step 1: Write the failing test** — `tests/test_mining_schema.py`

```python
import pytest
from industry_analysis.mining.schema import parse_candidates, ParseError

def test_parses_fenced_json():
    raw = '```json\n{"children":[{"name_cn":"芯片","name_en":"Chip","node_type":"sub_industry","description":"d"}]}\n```'
    batch = parse_candidates(raw)
    assert batch.children[0].name_en == "Chip"
    assert batch.children[0].aliases == []

def test_bad_json_raises(): 
    with pytest.raises(ParseError):
        parse_candidates("not json at all")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mining_schema.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create `src/industry_analysis/mining/schema.py`**

```python
import json
import re
from pydantic import BaseModel, Field, ValidationError


class ParseError(Exception):
    pass


class CandidateChild(BaseModel):
    name_cn: str
    name_en: str
    aliases: list[str] = Field(default_factory=list)
    node_type: str
    bottleneck_layer: str | None = None
    description: str = ""
    evidence_grade: str | None = None
    relation_rationale: str = ""
    sources: list[str] = Field(default_factory=list)


class CandidateBatch(BaseModel):
    children: list[CandidateChild] = Field(default_factory=list)


def _extract_json(raw: str) -> str:
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if fence:
        return fence.group(1)
    brace = re.search(r"\{.*\}", raw, re.DOTALL)
    if brace:
        return brace.group(0)
    raise ParseError("no JSON object found in agent output")


def parse_candidates(raw: str) -> CandidateBatch:
    try:
        return CandidateBatch.model_validate(json.loads(_extract_json(raw)))
    except (json.JSONDecodeError, ValidationError) as e:
        raise ParseError(str(e)) from e
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mining_schema.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/mining/__init__.py src/industry_analysis/mining/schema.py tests/test_mining_schema.py
git commit -m "feat: mining candidate schema + tolerant JSON parser"
```

---

## Task 9: Mining prompt builder

**Files:**
- Create: `src/industry_analysis/mining/prompt.py`, `tests/test_mining_prompt.py`

- [ ] **Step 1: Write the failing test** — `tests/test_mining_prompt.py`

```python
from industry_analysis.mining.prompt import build_expand_prompt
from industry_analysis.graph.models import Node, NodeType

def test_prompt_includes_context_and_schema():
    node = Node(id="ai", name_cn="AI基础设施", name_en="AI Infra", node_type=NodeType.theme,
                theme_ids=["ai"], description="AI 算力")
    p = build_expand_prompt(node, parent_chain=[node], existing_children=["芯片"])
    assert "AI基础设施" in p
    assert "芯片" in p            # tells agent what already exists (avoid dup)
    assert "children" in p        # output schema mentioned
    assert "技术物理层" in p      # methodology layers injected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mining_prompt.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create `src/industry_analysis/mining/prompt.py`**

```python
from industry_analysis.graph.models import Node

_SCHEMA = '''Return ONLY a JSON object: {"children": [ {
  "name_cn": str, "name_en": str, "aliases": [str],
  "node_type": "sub_industry|module|component|material|precursor|equipment",
  "bottleneck_layer": "技术物理层|工艺设备层|材料前驱体层|量产生态层|资本市场层" or null,
  "description": str, "evidence_grade": "A|B|C|D|E", "relation_rationale": str, "sources": [str]
} ] }'''

_METHOD = (
    "沿『下游→上游』按瓶颈五层下钻：技术物理层 / 工艺设备层 / 材料前驱体层 / 量产生态层 / 资本市场层。"
    "只挖出该节点的直接上游环节（不要跳层、不要直接给公司）。"
    "用 A–E 证据分级标注每个候选（A=监管/财报/客户官方，E=无源待核验）。"
    "为可能跨主题复用的关键环节给出 aliases（中英文/化学式/代号），便于去重。"
)


def build_expand_prompt(node: Node, parent_chain: list[Node], existing_children: list[str]) -> str:
    chain = " → ".join(f"{n.name_cn}({n.name_en})" for n in reversed(parent_chain))
    existing = "、".join(existing_children) if existing_children else "（无）"
    return (
        f"你是产业链瓶颈挖掘分析师。当前节点：{node.name_cn} / {node.name_en}"
        f"（类型 {node.node_type.value}）。\n"
        f"下游路径：{chain}\n"
        f"该节点已知的直接上游（请勿重复）：{existing}\n\n"
        f"方法论：{_METHOD}\n\n"
        f"{_SCHEMA}"
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mining_prompt.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/mining/prompt.py tests/test_mining_prompt.py
git commit -m "feat: expand prompt builder (context + methodology + schema)"
```

---

## Task 10: Mining engine — expand (idempotent + dedup + auto-confirm)

**Files:**
- Create: `src/industry_analysis/mining/engine.py`, `tests/test_mining_engine.py`

- [ ] **Step 1: Write the failing test** — `tests/test_mining_engine.py`

```python
import pytest
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType, NodeStatus
from industry_analysis.mining.engine import expand

class FakeClient:
    def __init__(self, out): self.out = out
    def run(self, agent, prompt): return self.out

@pytest.fixture
def store(tmp_path):
    s = GraphStore(tmp_path / "g.db")
    s.upsert_node(Node(id="ai", name_cn="AI", name_en="AI", node_type=NodeType.theme,
                       theme_ids=["ai"], status=NodeStatus.confirmed, description=""))
    return s

_OUT = '{"children":[{"name_cn":"芯片","name_en":"Chip","aliases":["IC"],"node_type":"sub_industry","description":"d","evidence_grade":"A"}]}'

def test_expand_creates_proposed_child_and_edge(store):
    res = expand(store, FakeClient(_OUT), "ai")
    assert res["created"] == 1
    child = store.find_by_name("Chip")
    assert child.status == NodeStatus.proposed
    assert child.theme_ids == ["ai"]            # inherits parent theme
    assert {n.id for n in store.suppliers("ai")} == {child.id}

def test_expand_is_idempotent(store):
    expand(store, FakeClient(_OUT), "ai")
    res2 = expand(store, FakeClient(_OUT), "ai")   # same output again
    assert res2["created"] == 0 and res2["skipped"] == 1
    assert len(store.suppliers("ai")) == 1

def test_existing_node_in_other_theme_gets_linked_not_duplicated(store):
    # pre-existing chip under a different theme
    store.upsert_node(Node(id="chip", name_cn="芯片", name_en="Chip", node_type=NodeType.sub_industry,
                           theme_ids=["robot"], status=NodeStatus.confirmed, description=""))
    res = expand(store, FakeClient(_OUT), "ai")
    assert res["linked"] == 1 and res["created"] == 0
    assert set(store.get_node("chip").theme_ids) == {"robot", "ai"}   # now a chokepoint

def test_auto_confirm_grade(store):
    res = expand(store, FakeClient(_OUT), "ai", auto_confirm_grade="A")
    assert store.find_by_name("Chip").status == NodeStatus.confirmed
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mining_engine.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create `src/industry_analysis/mining/engine.py`**

```python
import re
from industry_analysis.graph.models import EvidenceGrade, Node, NodeStatus, NodeType, normalize
from industry_analysis.mining.prompt import build_expand_prompt
from industry_analysis.mining.schema import parse_candidates

_GRADES = ["A", "B", "C", "D", "E"]
_STRUCTURAL = {NodeType.sub_industry, NodeType.module, NodeType.component}


def _slug(name_en: str, name_cn: str) -> str:
    base = normalize(name_en) or normalize(name_cn)
    return re.sub(r"[^0-9a-z一-鿿]", "", base)[:48] or "node"


def _grade_ok(grade: str | None, threshold: str | None) -> bool:
    if threshold is None or grade is None:
        return False
    return _GRADES.index(grade) <= _GRADES.index(threshold)


def expand(store, client, node_id: str, agent: str = "chain-miner", auto_confirm_grade=None) -> dict:
    node = store.get_node(node_id)
    if node is None:
        raise ValueError(f"node not found: {node_id}")

    existing = store.suppliers(node_id)
    existing_keys = {normalize(x) for n in existing for x in n.all_names()}

    prompt = build_expand_prompt(node, store.path_to_root(node_id), [n.name_cn for n in existing])
    batch = parse_candidates(client.run(agent, prompt))   # ParseError propagates (fail loud)

    created = linked = skipped = 0
    for c in batch.children:
        names = [c.name_cn, c.name_en, *c.aliases]
        if any(normalize(x) in existing_keys for x in names):
            skipped += 1
            continue
        match = next((store.find_by_name(x) for x in names if store.find_by_name(x)), None)
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
    return {"created": created, "linked": linked, "skipped": skipped}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mining_engine.py -v`
Expected: PASS (all four tests)

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/mining/engine.py tests/test_mining_engine.py
git commit -m "feat: expand engine (idempotent, alias dedup, cross-theme link, auto-confirm)"
```

---

## Task 11: Mining engine — batch_expand

**Files:**
- Modify: `src/industry_analysis/mining/engine.py`
- Modify: `tests/test_mining_engine.py` (append)

- [ ] **Step 1: Append the failing test** to `tests/test_mining_engine.py`

```python
def test_batch_expand_two_levels(store):
    # level1: ai -> 芯片 ; level2: 芯片 -> 晶圆
    # chip's prompt contains BOTH "芯片" and "AI" (AI is in its downstream path),
    # so check the more specific key first.
    outs = [
        ("芯片", '{"children":[{"name_cn":"晶圆","name_en":"Wafer","node_type":"material","description":"d","evidence_grade":"C"}]}'),
        ("AI", '{"children":[{"name_cn":"芯片","name_en":"Chip","node_type":"sub_industry","description":"d","evidence_grade":"C"}]}'),
    ]
    class Router:
        def run(self, agent, prompt):
            for k, v in outs:
                if k in prompt:
                    return v
            return '{"children":[]}'
    from industry_analysis.mining.engine import batch_expand
    res = batch_expand(store, Router(), "ai", depth=2)
    assert store.find_by_name("Wafer") is not None
    assert res["levels"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mining_engine.py::test_batch_expand_two_levels -v`
Expected: FAIL with `ImportError: cannot import name 'batch_expand'`

- [ ] **Step 3: Append `batch_expand` to `engine.py`**

```python
def batch_expand(store, client, node_id: str, depth: int = 1, agent="chain-miner", auto_confirm_grade=None) -> dict:
    frontier, totals = [node_id], {"created": 0, "linked": 0, "skipped": 0, "levels": 0}
    for _ in range(depth):
        if not frontier:
            break
        next_frontier = []
        for nid in frontier:
            before = {n.id for n in store.suppliers(nid)}
            r = expand(store, client, nid, agent=agent, auto_confirm_grade=auto_confirm_grade)
            for k in ("created", "linked", "skipped"):
                totals[k] += r[k]
            next_frontier += [n.id for n in store.suppliers(nid) if n.id not in before]
        frontier = next_frontier
        totals["levels"] += 1
    return totals
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mining_engine.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/mining/engine.py tests/test_mining_engine.py
git commit -m "feat: batch_expand BFS to depth N"
```

---

## Task 12: Review queue (approve/reject/merge + bulk)

**Files:**
- Create: `src/industry_analysis/review/__init__.py` (empty), `src/industry_analysis/review/queue.py`, `tests/test_review.py`

- [ ] **Step 1: Write the failing test** — `tests/test_review.py`

```python
import pytest
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import Node, NodeType, NodeStatus
from industry_analysis.review import queue

@pytest.fixture
def store(tmp_path):
    s = GraphStore(tmp_path / "g.db")
    s.upsert_node(Node(id="ai", name_cn="AI", name_en="AI", node_type=NodeType.theme,
                       theme_ids=["ai"], status=NodeStatus.confirmed, description=""))
    for i, t in (("chip", NodeType.sub_industry), ("ic", NodeType.sub_industry)):
        s.upsert_node(Node(id=i, name_cn=i, name_en=i, node_type=t, theme_ids=["ai"], description=""))
        s.add_edge(i, "ai", "")
    return s

def test_approve_reject(store):
    queue.approve(store, "chip")
    assert store.get_node("chip").status == NodeStatus.confirmed
    queue.reject(store, "ic")
    assert store.get_node("ic").status == NodeStatus.rejected

def test_pending_list(store):
    assert {n.id for n in queue.pending(store)} == {"chip", "ic"}

def test_merge_moves_edges_and_aliases(store):
    # ic is a duplicate of chip: merge ic into chip
    queue.merge(store, "ic", into="chip")
    assert store.get_node("ic").status == NodeStatus.rejected
    assert "ic" in [a for a in store.get_node("chip").aliases]
    # ic's downstream edge (ic->ai) now exists as chip->ai (already did) and ic has none dangling
    assert {n.id for n in store.suppliers("ai")} == {"chip"}

def test_bulk_approve_by_type(store):
    n = queue.approve_bulk(store, node_type=NodeType.sub_industry)
    assert n == 2
    assert all(x.status == NodeStatus.confirmed for x in (store.get_node("chip"), store.get_node("ic")))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_review.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create `src/industry_analysis/review/queue.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_review.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/review/ tests/test_review.py
git commit -m "feat: review queue (approve/reject/merge/bulk)"
```

---

## Task 13: Theme seed file + loader

**Files:**
- Create: `seeds/ark_themes_2026.yaml`, `src/industry_analysis/themes/__init__.py` (empty), `src/industry_analysis/themes/loader.py`, `tests/test_themes.py`

- [ ] **Step 1: Create `seeds/ark_themes_2026.yaml`** (13 themes; ids stable)

```yaml
themes:
  - {id: ai-infrastructure, name_cn: AI基础设施, name_en: AI Infrastructure}
  - {id: ai-consumer-os, name_cn: AI消费操作系统, name_en: AI Consumer Operating System}
  - {id: ai-productivity, name_cn: AI生产力, name_en: AI Productivity}
  - {id: bitcoin, name_cn: 比特币, name_en: Bitcoin}
  - {id: tokenized-assets, name_cn: 资产代币化, name_en: Tokenized Assets}
  - {id: defi, name_cn: DeFi应用, name_en: DeFi Applications}
  - {id: multiomics, name_cn: 多组学, name_en: Multiomics}
  - {id: reusable-rockets, name_cn: 可复用火箭, name_en: Reusable Rockets}
  - {id: robotics, name_cn: 机器人, name_en: Robotics}
  - {id: distributed-energy, name_cn: 分布式能源, name_en: Distributed Energy}
  - {id: autonomous-vehicles, name_cn: 自动驾驶, name_en: Autonomous Vehicles}
  - {id: autonomous-logistics, name_cn: 自动物流, name_en: Autonomous Logistics}
  - {id: great-acceleration, name_cn: 大加速, name_en: The Great Acceleration}
```

- [ ] **Step 2: Write the failing test** — `tests/test_themes.py`

```python
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import NodeType, NodeStatus
from industry_analysis.themes.loader import load_themes

def test_load_themes(tmp_path):
    store = GraphStore(tmp_path / "g.db")
    n = load_themes(store, "seeds/ark_themes_2026.yaml")
    assert n == 13
    robotics = store.get_node("robotics")
    assert robotics.node_type == NodeType.theme
    assert robotics.status == NodeStatus.confirmed
    assert robotics.theme_ids == ["robotics"]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_themes.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 4: Create `src/industry_analysis/themes/loader.py`**

```python
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_themes.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add seeds/ark_themes_2026.yaml src/industry_analysis/themes/ tests/test_themes.py
git commit -m "feat: ARK theme seed + loader"
```

---

## Task 14: `ia` CLI (typer)

**Files:**
- Create: `src/industry_analysis/cli/__init__.py` (empty), `src/industry_analysis/cli/main.py`, `tests/test_cli.py`

- [ ] **Step 1: Write the failing test** — `tests/test_cli.py`

```python
import json
from typer.testing import CliRunner
from industry_analysis.cli.main import app

runner = CliRunner()

def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("IA_DB_PATH", str(tmp_path / "g.db"))

def test_theme_load_and_list_json(tmp_path, monkeypatch):
    _env(tmp_path, monkeypatch)
    assert runner.invoke(app, ["theme", "load"]).exit_code == 0
    res = runner.invoke(app, ["node", "list", "--type", "theme", "--json"])
    assert res.exit_code == 0
    data = json.loads(res.stdout)
    assert len(data) == 13

def test_chokepoints_empty(tmp_path, monkeypatch):
    _env(tmp_path, monkeypatch)
    runner.invoke(app, ["theme", "load"])
    res = runner.invoke(app, ["chokepoints", "--json"])
    assert json.loads(res.stdout) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_cli.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create `src/industry_analysis/cli/main.py`**

```python
import json as _json
import typer
from industry_analysis.config import get_settings
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import NodeType, NodeStatus
from industry_analysis.quantagent.client import QuantAgentClient
from industry_analysis.mining.engine import expand as _expand, batch_expand as _batch
from industry_analysis.themes.loader import load_themes
from industry_analysis.review import queue

app = typer.Typer(no_args_is_help=True)
theme_app = typer.Typer()
node_app = typer.Typer()
review_app = typer.Typer()
app.add_typer(theme_app, name="theme")
app.add_typer(node_app, name="node")
app.add_typer(review_app, name="review")


def _store() -> GraphStore:
    return GraphStore(get_settings().db_path)


def _client() -> QuantAgentClient:
    s = get_settings()
    return QuantAgentClient(s.quantagent_cli, s.quantagent_agents_dir, s.node_path, s.quantagent_timeout)


def _emit(obj, as_json: bool):
    if as_json:
        typer.echo(_json.dumps(obj, ensure_ascii=False, default=str))
    else:
        typer.echo(obj)


@theme_app.command("load")
def theme_load(seed: str = "seeds/ark_themes_2026.yaml"):
    typer.echo(f"loaded {load_themes(_store(), seed)} themes")


@node_app.command("list")
def node_list(type: str = None, theme: str = None, status: str = None, json: bool = False):
    s = _store()
    nodes = s.list_nodes(
        status=NodeStatus(status) if status else None,
        node_type=NodeType(type) if type else None,
        theme_id=theme,
    )
    _emit([n.model_dump(mode="json") for n in nodes] if json
          else "\n".join(f"{n.id}\t{n.node_type.value}\t{n.name_cn}" for n in nodes), json)


@node_app.command("show")
def node_show(node_id: str, json: bool = False):
    n = _store().get_node(node_id)
    _emit(n.model_dump(mode="json") if (n and json) else (str(n) if n else "not found"), json and n)


@node_app.command("path")
def node_path(node_id: str):
    typer.echo(" → ".join(n.name_cn for n in reversed(_store().path_to_root(node_id))))


@app.command()
def expand(node_id: str, auto_depth: int = 1, json: bool = False):
    s, c = _store(), _client()
    cfg = get_settings().auto_confirm_grade
    res = (_batch(s, c, node_id, depth=auto_depth, auto_confirm_grade=cfg) if auto_depth > 1
           else _expand(s, c, node_id, auto_confirm_grade=cfg))
    _emit(res, json)


@app.command()
def search(keyword: str, json: bool = False):
    kw = keyword.lower()
    hits = [n for n in _store().list_nodes()
            if kw in n.name_cn.lower() or kw in n.name_en.lower() or kw in n.description.lower()]
    _emit([n.model_dump(mode="json") for n in hits] if json
          else "\n".join(f"{n.id}\t{n.name_cn}" for n in hits), json)


@app.command()
def chokepoints(min_themes: int = 2, json: bool = False):
    cps = _store().chokepoints(min_themes)
    _emit([n.model_dump(mode="json") for n in cps] if json
          else "\n".join(f"{n.id}\t{n.theme_ids}\t{n.name_cn}" for n in cps), json)


@review_app.command("list")
def review_list(json: bool = False):
    nodes = queue.pending(_store())
    _emit([n.model_dump(mode="json") for n in nodes] if json
          else "\n".join(f"{n.id}\t{n.name_cn}" for n in nodes), json)


@review_app.command("approve")
def review_approve(node_id: str):
    queue.approve(_store(), node_id); typer.echo(f"approved {node_id}")


@review_app.command("reject")
def review_reject(node_id: str):
    queue.reject(_store(), node_id); typer.echo(f"rejected {node_id}")


@review_app.command("merge")
def review_merge(node_id: str, into: str):
    queue.merge(_store(), node_id, into); typer.echo(f"merged {node_id} into {into}")


@app.command("export")
def graph_export(out: str = "graph.json"):
    import json as j
    open(out, "w", encoding="utf-8").write(j.dumps(_store().export(), ensure_ascii=False, indent=2))
    typer.echo(f"exported -> {out}")


if __name__ == "__main__":
    app()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_cli.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/cli/ tests/test_cli.py
git commit -m "feat: ia CLI (typer): theme/node/expand/review/chokepoints/export"
```

---

## Task 15: Dashboard backend (FastAPI)

**Files:**
- Create: `src/industry_analysis/dashboard/__init__.py` (empty), `src/industry_analysis/dashboard/app.py`, `tests/test_dashboard.py`

- [ ] **Step 1: Write the failing test** — `tests/test_dashboard.py`

```python
from fastapi.testclient import TestClient
from industry_analysis.dashboard.app import create_app
from industry_analysis.graph.store import GraphStore
from industry_analysis.themes.loader import load_themes

def test_graph_endpoint(tmp_path):
    db = tmp_path / "g.db"
    load_themes(GraphStore(db), "seeds/ark_themes_2026.yaml")
    client = TestClient(create_app(db_path=db))
    r = client.get("/api/graph")
    assert r.status_code == 200
    assert len(r.json()["nodes"]) == 13

def test_node_detail_404(tmp_path):
    client = TestClient(create_app(db_path=tmp_path / "g.db"))
    assert client.get("/api/node/nope").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_dashboard.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create `src/industry_analysis/dashboard/app.py`**

```python
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from industry_analysis.config import get_settings
from industry_analysis.graph.store import GraphStore
from industry_analysis.review import queue

_STATIC = Path(__file__).parent / "static"


def create_app(db_path=None) -> FastAPI:
    db = db_path or get_settings().db_path
    app = FastAPI(title="IndustryAnalysis")

    def store():
        return GraphStore(db)

    @app.get("/")
    def index():
        return FileResponse(_STATIC / "index.html")

    @app.get("/api/graph")
    def graph():
        return store().export()

    @app.get("/api/node/{node_id}")
    def node(node_id: str):
        n = store().get_node(node_id)
        if not n:
            raise HTTPException(404, "node not found")
        return n.model_dump(mode="json")

    @app.get("/api/chokepoints")
    def chokepoints(min_themes: int = 2):
        return [n.model_dump(mode="json") for n in store().chokepoints(min_themes)]

    @app.get("/api/review")
    def review():
        return [n.model_dump(mode="json") for n in queue.pending(store())]

    @app.post("/api/review/{node_id}")
    def review_act(node_id: str, action: str):
        s = store()
        if action == "approve":
            queue.approve(s, node_id)
        elif action == "reject":
            queue.reject(s, node_id)
        else:
            raise HTTPException(400, "action must be approve|reject")
        return {"ok": True}

    return app


app = create_app()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_dashboard.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/dashboard/__init__.py src/industry_analysis/dashboard/app.py tests/test_dashboard.py
git commit -m "feat: dashboard FastAPI backend"
```

---

## Task 16: Dashboard frontend (Cytoscape.js) + manual smoke

**Files:**
- Create: `src/industry_analysis/dashboard/static/index.html`

- [ ] **Step 1: Create `src/industry_analysis/dashboard/static/index.html`**

```html
<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <title>IndustryAnalysis · 产业链</title>
  <script src="https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js"></script>
  <style>
    body { margin: 0; font-family: sans-serif; display: flex; height: 100vh; }
    #cy { flex: 1; height: 100%; }
    #panel { width: 320px; border-left: 1px solid #ddd; padding: 12px; overflow: auto; }
    #bar { position: absolute; z-index: 5; padding: 8px; }
    pre { white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="bar">
    <input id="q" placeholder="搜索..." />
    <label><input type="checkbox" id="onlyCp" /> 只看瓶颈</label>
  </div>
  <div id="cy"></div>
  <div id="panel"><em>点击节点查看详情</em></div>
  <script>
    const COLORS = { theme:'#1f77b4', sub_industry:'#2ca02c', module:'#17becf', component:'#9467bd',
                     material:'#ff7f0e', precursor:'#d62728', equipment:'#8c564b', company:'#7f7f7f' };
    let cy;
    async function load() {
      const g = await (await fetch('/api/graph')).json();
      const cps = new Set((await (await fetch('/api/chokepoints')).json()).map(n => n.id));
      const els = [];
      for (const n of g.nodes) els.push({ data: { id:n.id, label:n.name_cn, type:n.node_type,
        cp: cps.has(n.id) ? 1 : 0 } });
      for (const e of g.edges) els.push({ data: { source:e.upstream_id, target:e.downstream_id } });
      cy = cytoscape({ container: document.getElementById('cy'), elements: els,
        layout: { name:'breadthfirst', directed:true },
        style: [
          { selector:'node', style:{ 'label':'data(label)', 'background-color': n => COLORS[n.data('type')] || '#999',
            'width':28, 'height':28, 'font-size':10 } },
          { selector:'node[cp=1]', style:{ 'border-width':4, 'border-color':'#e6194b' } },
          { selector:'edge', style:{ 'width':1.5, 'line-color':'#bbb', 'target-arrow-shape':'triangle',
            'target-arrow-color':'#bbb', 'curve-style':'bezier' } },
        ]});
      cy.on('tap', 'node', async ev => {
        const d = await (await fetch('/api/node/' + ev.target.id())).json();
        document.getElementById('panel').innerHTML =
          `<h3>${d.name_cn} / ${d.name_en}</h3><p><b>类型</b>: ${d.node_type} · <b>层</b>: ${d.bottleneck_layer||'-'}</p>`+
          `<p><b>主题</b>: ${d.theme_ids.join(', ')}</p><p><b>证据</b>: ${d.evidence_grade||'-'} · <b>状态</b>: ${d.status}</p>`+
          `<p>${d.description||''}</p><pre>${d.evidence_md||''}</pre>`;
      });
    }
    document.getElementById('q').addEventListener('input', e => {
      const v = e.target.value.trim();
      cy.nodes().forEach(n => n.style('display',
        !v || (n.data('label')||'').includes(v) ? 'element' : 'none'));
    });
    document.getElementById('onlyCp').addEventListener('change', e => {
      cy.nodes().forEach(n => n.style('display',
        !e.target.checked || n.data('cp') ? 'element' : 'none'));
    });
    load();
  </script>
</body>
</html>
```

- [ ] **Step 2: Manual smoke test** (no automated test for static page)

Run:
```bash
pip install -e ".[dev]"
ia theme load
ia expand robotics            # requires QuantAgent reachable; produces proposed nodes
uvicorn industry_analysis.dashboard.app:app --port 8300
```
Open `http://127.0.0.1:8300/` — expected: 13 theme nodes render; clicking a node fills the right panel; "只看瓶颈" toggle hides non-chokepoint nodes.

- [ ] **Step 3: Commit**

```bash
git add src/industry_analysis/dashboard/static/index.html
git commit -m "feat: Cytoscape.js dashboard page"
```

---

## Task 17: chain-miner agent + AGENTS.md + full test run

**Files:**
- Create: `.quantagent/agents/chain-miner.md`, `AGENTS.md`

- [ ] **Step 1: Create `.quantagent/agents/chain-miner.md`**

```markdown
---
name: chain-miner
description: 沿产业链下游→上游下钻，挖出某节点的直接上游环节（瓶颈五层法），输出结构化 JSON 候选子节点
model: claude-opus-4-8
tools: [WebSearch, WebFetch]
---

你是产业链瓶颈挖掘分析师。给定一个产业链节点及其下游路径，挖出它的**直接上游环节**。

规则：
- 沿瓶颈五层下钻：技术物理层 / 工艺设备层 / 材料前驱体层 / 量产生态层 / 资本市场层。
- 只挖**直接上游一层**，不要跳层，不要直接给到具体公司（除非节点类型已是 capital_market）。
- 每个候选用 A–E 证据分级（A=监管/财报/客户官方一手；B=论文/专利/标准；C=行业媒体/研报；D=逻辑相关无直证；E=无源待核验）。
- 对可能跨主题复用的关键环节，给出 aliases（中英文、化学式、代号），便于跨产业链去重。
- 用 WebSearch/WebFetch 核验，但**只输出 JSON**，不要输出解释性文字。

严格输出（仅此 JSON，无其它文本）：
{"children":[{"name_cn":"","name_en":"","aliases":[],"node_type":"sub_industry|module|component|material|precursor|equipment","bottleneck_layer":"技术物理层|工艺设备层|材料前驱体层|量产生态层|资本市场层","description":"","evidence_grade":"A|B|C|D|E","relation_rationale":"","sources":[]}]}
```

- [ ] **Step 2: Create `AGENTS.md`**

```markdown
# IndustryAnalysis

ARK-2026-theme-rooted 产业链 DAG. Mines downstream→upstream via the QuantAgent CLI.

## Architecture
- This project does NO LLM calls. All node expansion goes through QuantAgent CLI.
- SQLite (`data/graph.db`) is the single source of truth (nodes/edges/review_log/evidence_md).
- Cross-theme shared nodes (chokepoints) emerge from alias-based dedup adding extra upstream_of edges.

## Edge convention
Edge = (upstream_id, downstream_id), "upstream supplies downstream". Expanding N adds (candidate, N).

## Commands
- `pip install -e ".[dev]"` ; `pytest -v`
- `ia theme load` ; `ia expand <node> [--auto-depth N]` ; `ia review list|approve|reject|merge`
- `ia chokepoints` ; `ia graph export`
- `uvicorn industry_analysis.dashboard.app:app --port 8300`

## Key paths
- QuantAgent CLI: `../QuantAgent/dist/cli.js` ; agents in `.quantagent/agents/`
- Spec: `docs/superpowers/specs/2026-05-30-supply-chain-mining-design.md`
```

- [ ] **Step 3: Run the full test suite**

Run: `pytest -v`
Expected: all tests PASS (test_config, test_models, test_store_*, test_quantagent_client, test_mining_*, test_review, test_themes, test_cli, test_dashboard)

- [ ] **Step 4: Commit**

```bash
git add .quantagent/agents/chain-miner.md AGENTS.md
git commit -m "feat: chain-miner agent + AGENTS.md; MVP complete"
```

---

## Self-Review Notes (covered against spec)

- §3.1 Node model → Task 2 (incl. `aliases`, `evidence_md`). §3.2 Edge + cycle → Task 4. §3.3 SQLite single source of truth → Task 3 (evidence_md TEXT column); markdown export deferred to a thin `export --md` (not in MVP critical path; `export --json` shipped in Task 6/14).
- §4 mining expand/batch + idempotency + alias dedup + cross-theme link → Tasks 10–11. §4.3 chain-miner agent → Task 17.
- §5 review approve/reject/merge + bulk + auto_confirm_grade → Tasks 10 (auto-confirm) + 12 (review/bulk).
- §6 theme loader → Task 13. §7 CLI → Task 14. §8 dashboard → Tasks 15–16. §9 fail-loud (QuantAgentError, ParseError propagate) → Tasks 7,8,10. §10 tests → every task.
- **Deferred (matches spec non-goals):** company-layer population, 100-point scoring, chain-quality-checker, `export --md` projection file writer (CLI `export` ships JSON; the `--md` variant is a post-MVP convenience).
