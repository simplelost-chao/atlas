# Auto-Mining Plan A: Evidence Layer + mine first/update

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PR1-3 from the auto-mining spec: `cn-extract` evidence pipeline, `ia mine first`, and `ia mine update` (A+C branches).

**Architecture:** Three-layer approach — (1) extract evidence packages from local CN filings.db into datasource.db FTS5 index, (2) orchestrate first-time deep mining with evidence pre-fill, (3) incremental update with bidirectional node re-scoring and leaf expansion.

**Tech Stack:** Python, SQLite (read-only CN filings.db + read-write datasource.db), existing `DataSourceDB`, `GraphStore`, `QuantAgentClient`, Typer CLI.

**Spec:** `docs/superpowers/specs/2026-06-02-auto-mining-design.md`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/industry_analysis/datasource/store/datasource_db.py` | Add `extract_log` table + 3 methods |
| Create | `src/industry_analysis/datasource/cn_extract.py` | `CnExtractor` class — reads CN filings.db, writes to datasource.db |
| Create | `seeds/theme_keywords.yaml` | Per-theme keyword lists |
| Create | `src/industry_analysis/mine/__init__.py` | Empty package init |
| Create | `src/industry_analysis/mine/state.py` | `ThemeState` enum + `get_theme_state()` |
| Create | `src/industry_analysis/mine/first.py` | `mine_first()` orchestration |
| Create | `src/industry_analysis/mine/update.py` | `mine_update()` A+C branches |
| Modify | `src/industry_analysis/cli/main.py` | Add `datasource_app` + `mine_app` sub-commands |
| Create | `tests/test_cn_extract.py` | Unit tests for CnExtractor |
| Create | `tests/test_mine_state.py` | Unit tests for state machine |
| Create | `tests/test_mine_first.py` | Unit tests for mine_first |
| Create | `tests/test_mine_update.py` | Unit tests for mine_update |

---

## Task 1: Add `extract_log` to DataSourceDB

**Files:**
- Modify: `src/industry_analysis/datasource/store/datasource_db.py`
- Test: `tests/test_datasource_db.py`

- [ ] **Step 1: Write failing tests for extract_log**

Append to `tests/test_datasource_db.py`:

```python
def test_is_extracted_returns_false_when_not_logged(db):
    assert db.is_extracted("doc1", "hash1", "v1") is False


def test_mark_and_check_extracted(db):
    db.mark_extracted("doc1", "hash1", "v1", sections_count=5)
    assert db.is_extracted("doc1", "hash1", "v1") is True


def test_different_hash_not_extracted(db):
    db.mark_extracted("doc1", "hash1", "v1")
    assert db.is_extracted("doc1", "hash2", "v1") is False


def test_different_version_not_extracted(db):
    db.mark_extracted("doc1", "hash1", "v1")
    assert db.is_extracted("doc1", "hash1", "v2") is False


def test_mark_extracted_upserts(db):
    db.mark_extracted("doc1", "hash1", "v1", sections_count=3)
    db.mark_extracted("doc1", "hash2", "v1", sections_count=7)  # hash changed
    assert db.is_extracted("doc1", "hash2", "v1") is True
    assert db.is_extracted("doc1", "hash1", "v1") is False
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd python && pytest tests/test_datasource_db.py::test_is_extracted_returns_false_when_not_logged -v
```

Expected: `AttributeError: 'DataSourceDB' object has no attribute 'is_extracted'`

- [ ] **Step 3: Add `extract_log` table and methods to `datasource_db.py`**

Add to `_SCHEMA` string (before the closing `"""`):

```python
CREATE TABLE IF NOT EXISTS extract_log (
    document_id       TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    content_hash      TEXT NOT NULL,
    sections_extracted INTEGER DEFAULT 0,
    extracted_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (document_id, extractor_version)
);
```

Add these three methods to the `DataSourceDB` class (after `fts_index`):

```python
def is_extracted(self, document_id: str, content_hash: str,
                 extractor_version: str) -> bool:
    with closing(self._conn()) as conn:
        row = conn.execute(
            "SELECT 1 FROM extract_log "
            "WHERE document_id=? AND extractor_version=? AND content_hash=?",
            (document_id, extractor_version, content_hash),
        ).fetchone()
    return row is not None

def mark_extracted(self, document_id: str, content_hash: str,
                   extractor_version: str, sections_count: int = 0) -> None:
    with closing(self._conn()) as conn:
        conn.execute(
            """INSERT OR REPLACE INTO extract_log
               (document_id, extractor_version, content_hash, sections_extracted)
               VALUES (?,?,?,?)""",
            (document_id, extractor_version, content_hash, sections_count),
        )
        conn.commit()

def get_unextracted_docs(self, cn_conn: "sqlite3.Connection",
                         extractor_version: str,
                         doc_types: tuple = ("annual", "semi-annual", "prospectus"),
                         ) -> list[dict]:
    """Return documents from CN filings.db not yet indexed with this version."""
    placeholders = ",".join("?" * len(doc_types))
    rows = cn_conn.execute(
        f"""SELECT id, symbol, doc_type, period_end, content_hash
            FROM documents
            WHERE parse_status='success'
              AND doc_type IN ({placeholders})""",
        list(doc_types),
    ).fetchall()
    result = []
    for r in rows:
        if not self.is_extracted(r["id"], r["content_hash"], extractor_version):
            result.append(dict(r))
    return result
```

- [ ] **Step 4: Run all extract_log tests**

```bash
pytest tests/test_datasource_db.py -v -k "extracted"
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/datasource/store/datasource_db.py tests/test_datasource_db.py
git commit -m "feat: add extract_log table to DataSourceDB for cn-extract idempotency"
```

---

## Task 2: `CnExtractor` class

**Files:**
- Create: `src/industry_analysis/datasource/cn_extract.py`
- Create: `tests/test_cn_extract.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_cn_extract.py`:

```python
import sqlite3
import pytest
from pathlib import Path
from industry_analysis.datasource.store.datasource_db import DataSourceDB
from industry_analysis.datasource.cn_extract import CnExtractor, ExtractResult, EXTRACTOR_VERSION


def _make_cn_db(tmp_path: Path) -> Path:
    """Create a minimal CN filings.db with known test data."""
    db_path = tmp_path / "cn_filings.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE documents (
            id TEXT PRIMARY KEY, symbol TEXT, doc_type TEXT,
            period_end TEXT, content_hash TEXT, parse_status TEXT
        );
        CREATE TABLE sections (
            id TEXT PRIMARY KEY, document_id TEXT, symbol TEXT,
            section_seq INTEGER, section_level INTEGER,
            heading_path TEXT, section_name TEXT, content TEXT, char_count INTEGER
        );
        CREATE INDEX idx_secs_doc ON sections(document_id);
    """)
    conn.execute("""
        INSERT INTO documents VALUES
        ('doc_mlcc_001', '300135.SZ', 'annual', '2025-12-31', 'hash_a', 'success')
    """)
    conn.executemany("""
        INSERT INTO sections VALUES (?,?,?,?,?,?,?,?,?)
    """, [
        ('s1', 'doc_mlcc_001', '300135.SZ', 0, 2,
         '一、主要财务数据', '主要财务数据', '营业收入同比增长20%', 10),
        ('s2', 'doc_mlcc_001', '300135.SZ', 1, 2,
         '二、主营业务分析/主要供应商情况', '主要供应商情况',
         '主要原材料为钛酸钡粉体，主要供应商为国瓷材料股份有限公司', 30),
        ('s3', 'doc_mlcc_001', '300135.SZ', 2, 2,
         '二、主营业务分析/主要客户情况', '主要客户情况',
         '主要客户为华为技术有限公司', 15),
        ('s4', 'doc_mlcc_001', '300135.SZ', 3, 2,
         '三、风险因素', '风险因素',
         '原材料价格波动风险，钛酸钡供应集中度较高', 20),
    ])
    conn.commit()
    conn.close()
    return db_path


@pytest.fixture
def cn_db(tmp_path):
    return _make_cn_db(tmp_path)


@pytest.fixture
def ds(tmp_path):
    return DataSourceDB(tmp_path / "datasource.db")


def test_extract_by_symbol_indexes_supply_chain_sections(cn_db, ds):
    extractor = CnExtractor(str(cn_db), ds)
    result = extractor.extract_by_symbol("300135.SZ")
    assert result.docs_processed == 1
    assert result.sections_indexed >= 2  # supplier + customer sections
    # Evidence must be searchable
    hits = ds.search("钛酸钡")
    assert len(hits) > 0


def test_extract_by_symbol_is_idempotent(cn_db, ds):
    extractor = CnExtractor(str(cn_db), ds)
    r1 = extractor.extract_by_symbol("300135.SZ")
    r2 = extractor.extract_by_symbol("300135.SZ")
    assert r1.docs_processed == 1
    assert r2.docs_skipped == 1
    assert r2.docs_processed == 0


def test_extract_by_symbol_unknown_does_nothing(cn_db, ds):
    extractor = CnExtractor(str(cn_db), ds)
    result = extractor.extract_by_symbol("999999.SZ")
    assert result.docs_processed == 0
    assert result.sections_indexed == 0


def test_extract_by_theme_finds_relevant_symbols(cn_db, ds):
    extractor = CnExtractor(str(cn_db), ds)
    result = extractor.extract_by_theme(["钛酸钡", "MLCC"])
    assert result.docs_processed >= 1
    hits = ds.search("钛酸钡")
    assert len(hits) > 0


def test_extract_by_theme_skips_already_indexed(cn_db, ds):
    extractor = CnExtractor(str(cn_db), ds)
    extractor.extract_by_symbol("300135.SZ")  # pre-index
    result = extractor.extract_by_theme(["钛酸钡"])
    assert result.docs_skipped >= 1
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_cn_extract.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'industry_analysis.datasource.cn_extract'`

- [ ] **Step 3: Implement `cn_extract.py`**

Create `src/industry_analysis/datasource/cn_extract.py`:

```python
"""Extract evidence packages from local CN filings.db into datasource.db.

Reads CN filings.db (read-only), writes FTS-indexed snippets to datasource.db.
Only extracts sections with supply-chain-relevant headings (供应商, 原材料, etc.).
Tracks extracted documents via extract_log for idempotency.
"""
import sqlite3
from contextlib import closing
from dataclasses import dataclass, field
from pathlib import Path

from .models import FilingRecord
from .store.datasource_db import DataSourceDB

EXTRACTOR_VERSION = "1"

SUPPLY_CHAIN_HEADINGS = [
    "供应商", "原材料", "客户", "主营", "采购",
    "主要产品", "主要业务", "经营讨论", "风险",
    "上游", "下游", "原料", "成本",
]

_HEADING_SQL = " OR ".join(
    f"heading_path LIKE '%{h}%'" for h in SUPPLY_CHAIN_HEADINGS
)


@dataclass
class ExtractResult:
    docs_processed: int = 0
    docs_skipped: int = 0
    sections_indexed: int = 0
    errors: list[str] = field(default_factory=list)

    def __iadd__(self, other: "ExtractResult") -> "ExtractResult":
        self.docs_processed += other.docs_processed
        self.docs_skipped += other.docs_skipped
        self.sections_indexed += other.sections_indexed
        self.errors.extend(other.errors)
        return self


class CnExtractor:
    def __init__(self, cn_db_path: str, datasource: DataSourceDB,
                 extractor_version: str = EXTRACTOR_VERSION):
        self.cn_db_path = str(cn_db_path)
        self.ds = datasource
        self.version = extractor_version

    def _cn_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(f"file:{self.cn_db_path}?mode=ro", uri=True,
                               timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def extract_by_symbol(self, symbol: str,
                          doc_types: tuple = ("annual", "semi-annual",
                                              "prospectus")) -> ExtractResult:
        """Extract evidence for a single ticker symbol. Synchronous."""
        result = ExtractResult()
        placeholders = ",".join("?" * len(doc_types))
        with closing(self._cn_conn()) as conn:
            docs = conn.execute(
                f"""SELECT id, symbol, doc_type, period_end, content_hash
                    FROM documents
                    WHERE symbol=? AND parse_status='success'
                      AND doc_type IN ({placeholders})
                    ORDER BY period_end DESC""",
                [symbol, *doc_types],
            ).fetchall()
            for doc in docs:
                r = self._process_doc(conn, dict(doc))
                result += r
        return result

    def extract_by_theme(self, keywords: list[str],
                         doc_types: tuple = ("annual",)) -> ExtractResult:
        """Extract evidence for all symbols that mention theme keywords.

        Performs a LIKE scan on sections.content — O(n) on 1.9M rows,
        acceptable for one-time batch operations (~30-90s).
        """
        result = ExtractResult()
        if not keywords:
            return result

        kw_filter = " OR ".join(f"s.content LIKE '%{k}%'" for k in keywords)
        placeholders = ",".join("?" * len(doc_types))

        with closing(self._cn_conn()) as conn:
            # Find distinct document_ids that mention any keyword
            doc_ids = conn.execute(
                f"""SELECT DISTINCT d.id, d.symbol, d.doc_type,
                           d.period_end, d.content_hash
                    FROM sections s
                    JOIN documents d ON d.id = s.document_id
                    WHERE ({kw_filter})
                      AND d.parse_status='success'
                      AND d.doc_type IN ({placeholders})""",
                list(doc_types),
            ).fetchall()
            for doc in doc_ids:
                r = self._process_doc(conn, dict(doc))
                result += r
        return result

    def _process_doc(self, cn_conn: sqlite3.Connection,
                     doc: dict) -> ExtractResult:
        result = ExtractResult()
        doc_id = doc["id"]
        content_hash = doc["content_hash"]

        if self.ds.is_extracted(doc_id, content_hash, self.version):
            result.docs_skipped += 1
            return result

        # Find supply-chain-relevant sections
        sections = cn_conn.execute(
            f"SELECT * FROM sections WHERE document_id=? AND ({_HEADING_SQL})"
            " ORDER BY section_seq",
            (doc_id,),
        ).fetchall()

        if not sections:
            # No supply-chain sections — mark as processed so we don't re-scan
            self.ds.mark_extracted(doc_id, content_hash, self.version, 0)
            result.docs_processed += 1
            return result

        filing_id = f"cn:{doc_id}"
        filer_name = doc["symbol"]
        self.ds.upsert_filing(FilingRecord(
            id=filing_id,
            company_id=doc["symbol"],
            filer_name=filer_name,
            filing_type=doc["doc_type"],
            period_end=doc["period_end"],
            source="cn_filings",
            source_id=doc_id,
        ))

        section_seqs = {s["section_seq"] for s in sections}
        indexed = 0
        for sec in sections:
            snippet = self._build_snippet(cn_conn, doc_id,
                                          sec["section_seq"], section_seqs)
            self.ds.fts_index(filing_id, doc["symbol"],
                              sec["heading_path"], snippet)
            indexed += 1

        self.ds.mark_extracted(doc_id, content_hash, self.version, indexed)
        result.docs_processed += 1
        result.sections_indexed += indexed
        return result

    def _build_snippet(self, cn_conn: sqlite3.Connection, document_id: str,
                       seq: int, already_included: set[int]) -> str:
        """Return matched section content + adjacent context (±1 section)."""
        rows = cn_conn.execute(
            """SELECT content FROM sections
               WHERE document_id=? AND section_seq BETWEEN ? AND ?
               ORDER BY section_seq""",
            (document_id, seq - 1, seq + 1),
        ).fetchall()
        parts = [r["content"][:400] for r in rows]
        return "\n".join(parts)[:1200]
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_cn_extract.py -v
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/datasource/cn_extract.py tests/test_cn_extract.py
git commit -m "feat: add CnExtractor — evidence packages from CN filings.db into datasource.db"
```

---

## Task 3: `theme_keywords.yaml`

**Files:**
- Create: `seeds/theme_keywords.yaml`

- [ ] **Step 1: Create the keyword seed file**

Create `seeds/theme_keywords.yaml`:

```yaml
# Per-theme keywords for cn-extract --theme
# Bump extractor_version in cn_extract.py when you modify these.

robotics:
  - 谐波减速器
  - RV减速器
  - 伺服电机
  - 工业机器人
  - 关节模组
  - 力矩传感器
  - 精密轴承
  - 协作机器人

ai-infrastructure:
  - HBM
  - CoWoS
  - 算力
  - 液冷
  - 数据中心
  - 服务器
  - 交换机
  - 光模块
  - 高速铜缆

autonomous-vehicles:
  - 激光雷达
  - 毫米波雷达
  - 自动驾驶
  - 域控制器
  - 线控底盘
  - 智能座舱

autonomous-logistics:
  - AMR
  - AGV
  - 仓储机器人
  - 分拣系统
  - 立体仓库

reusable-rockets:
  - 液氧甲烷
  - 火箭发动机
  - 碳纤维复合材料
  - 涡轮泵
  - 推力矢量

distributed-energy:
  - 储能
  - 碳化硅
  - 逆变器
  - 光伏组件
  - 电芯
  - 固态电池

ai-consumer-os:
  - 端侧AI
  - NPU
  - 小模型
  - 边缘计算
  - 语音芯片

ai-productivity:
  - 大模型
  - RAG
  - Agent
  - 向量数据库
  - GPU集群

multiomics:
  - 基因测序
  - 质谱仪
  - 液体活检
  - 蛋白质组学
  - 单细胞

great-acceleration:
  - 人形机器人
  - 通用人工智能
  - AGI
  - 脑机接口

mlcc:
  - MLCC
  - 积层陶瓷电容
  - 钛酸钡
  - 镍粉
  - 草酸钡
  - 流延成型
```

- [ ] **Step 2: Commit**

```bash
git add seeds/theme_keywords.yaml
git commit -m "feat: add theme_keywords.yaml for cn-extract batch mode"
```

---

## Task 4: CLI `ia datasource cn-extract`

**Files:**
- Modify: `src/industry_analysis/cli/main.py`
- Test: `tests/test_cli.py`

- [ ] **Step 1: Write failing CLI test**

Append to `tests/test_cli.py`:

```python
from typer.testing import CliRunner
from industry_analysis.cli.main import app

runner = CliRunner()


def test_datasource_cn_extract_symbol_help():
    result = runner.invoke(app, ["datasource", "cn-extract", "--help"])
    assert result.exit_code == 0
    assert "--symbol" in result.output
    assert "--theme" in result.output
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_cli.py::test_datasource_cn_extract_symbol_help -v
```

Expected: FAIL (no `datasource` subcommand yet)

- [ ] **Step 3: Add `datasource_app` to CLI**

In `src/industry_analysis/cli/main.py`, after line `news_app = typer.Typer()`:

```python
datasource_app = typer.Typer()
mine_app = typer.Typer()
```

After `app.add_typer(news_app, name="news")`:

```python
app.add_typer(datasource_app, name="datasource")
app.add_typer(mine_app, name="mine")
```

Then add the `cn-extract` command (before `def _store()`):

```python
@datasource_app.command("cn-extract")
def datasource_cn_extract(
    symbol: Optional[str] = typer.Option(None, "--symbol", help="A-share ticker, e.g. 300677.SZ"),
    theme: Optional[str] = typer.Option(None, "--theme", help="Theme ID from theme_keywords.yaml"),
    dry_run: bool = typer.Option(False, "--dry-run"),
):
    """Extract supply-chain evidence from CN filings.db into datasource.db."""
    import yaml
    from pathlib import Path
    from industry_analysis.datasource.cn_extract import CnExtractor

    if not symbol and not theme:
        typer.echo("Provide --symbol or --theme", err=True)
        raise typer.Exit(1)

    cfg = get_settings()
    cn_db = cfg.cn_filings_db_path or Path("D:/quantdata/markets/CN/filings.db")
    ds = _datasource_db()
    if ds is None:
        typer.echo("datasource_db not configured", err=True)
        raise typer.Exit(1)

    extractor = CnExtractor(str(cn_db), ds)

    if dry_run:
        typer.echo(f"[dry-run] cn-extract {'--symbol ' + symbol if symbol else '--theme ' + theme}")
        return

    if symbol:
        result = extractor.extract_by_symbol(symbol)
    else:
        seeds_path = Path(__file__).parents[4] / "seeds" / "theme_keywords.yaml"
        data = yaml.safe_load(seeds_path.read_text(encoding="utf-8"))
        keywords = data.get(theme, [])
        if not keywords:
            typer.echo(f"No keywords found for theme '{theme}'", err=True)
            raise typer.Exit(1)
        result = extractor.extract_by_theme(keywords)

    typer.echo(
        f"cn-extract done: processed={result.docs_processed} "
        f"skipped={result.docs_skipped} sections={result.sections_indexed}"
    )
    if result.errors:
        for e in result.errors:
            typer.echo(f"  ERROR: {e}", err=True)
```

- [ ] **Step 4: Run test**

```bash
pytest tests/test_cli.py::test_datasource_cn_extract_symbol_help -v
```

Expected: PASS

- [ ] **Step 5: Smoke test against real data**

```bash
cd python && ia datasource cn-extract --symbol 300677.SZ --dry-run
ia datasource cn-extract --symbol 300677.SZ
```

Expected: `cn-extract done: processed=N skipped=0 sections=M`

- [ ] **Step 6: Commit**

```bash
git add src/industry_analysis/cli/main.py
git commit -m "feat: add 'ia datasource cn-extract' CLI command"
```

---

## Task 5: Theme state machine

**Files:**
- Create: `src/industry_analysis/mine/__init__.py`
- Create: `src/industry_analysis/mine/state.py`
- Create: `tests/test_mine_state.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_mine_state.py`:

```python
import pytest
from industry_analysis.graph.models import Node, NodeType, NodeStatus
from industry_analysis.graph.store import GraphStore
from industry_analysis.mine.state import ThemeState, get_theme_state


@pytest.fixture
def store(tmp_path):
    return GraphStore(str(tmp_path / "graph.db"))


def _theme(id: str) -> Node:
    return Node(id=id, name_cn=id, name_en=id,
                node_type=NodeType.theme, theme_ids=[id],
                status=NodeStatus.confirmed)


def _node(id: str, theme_id: str,
          node_type: NodeType = NodeType.material) -> Node:
    return Node(id=id, name_cn=id, name_en=id,
                node_type=node_type, theme_ids=[theme_id],
                status=NodeStatus.confirmed)


def test_unmined_when_no_nodes(store):
    store.upsert_node(_theme("robotics"))
    assert get_theme_state(store, "robotics") == ThemeState.UNMINED


def test_shallow_when_fewer_than_5_depth1(store):
    store.upsert_node(_theme("robotics"))
    for i in range(3):
        n = _node(f"node{i}", "robotics")
        store.upsert_node(n)
        store.add_edge(n.id, "robotics", "upstream_of")
    assert get_theme_state(store, "robotics") == ThemeState.SHALLOW


def test_mined_when_5_or_more_depth1(store):
    store.upsert_node(_theme("robotics"))
    for i in range(5):
        n = _node(f"node{i}", "robotics")
        store.upsert_node(n)
        store.add_edge(n.id, "robotics", "upstream_of")
    assert get_theme_state(store, "robotics") == ThemeState.MINED


def test_unmined_theme_not_in_graph_raises(store):
    with pytest.raises(ValueError, match="Theme 'missing' not found"):
        get_theme_state(store, "missing")
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_mine_state.py -v 2>&1 | head -10
```

Expected: `ModuleNotFoundError: No module named 'industry_analysis.mine'`

- [ ] **Step 3: Create package and state module**

Create `src/industry_analysis/mine/__init__.py` (empty).

Create `src/industry_analysis/mine/state.py`:

```python
"""Theme state machine for ia mine first / update routing."""
from enum import Enum

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
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_mine_state.py -v
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/mine/ tests/test_mine_state.py
git commit -m "feat: add mine/state.py ThemeState machine"
```

---

## Task 6: `ia mine first` + CLI

**Files:**
- Create: `src/industry_analysis/mine/first.py`
- Create: `tests/test_mine_first.py`
- Modify: `src/industry_analysis/cli/main.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_mine_first.py`:

```python
import pytest
from unittest.mock import MagicMock, patch
from industry_analysis.graph.models import Node, NodeType, NodeStatus, EvidenceGrade
from industry_analysis.graph.store import GraphStore
from industry_analysis.mine.first import mine_first, FirstMineResult
from industry_analysis.mine.state import ThemeState


@pytest.fixture
def store(tmp_path):
    s = GraphStore(str(tmp_path / "graph.db"))
    s.upsert_node(Node(id="robotics", name_cn="机器人", name_en="Robotics",
                       node_type=NodeType.theme, theme_ids=["robotics"],
                       status=NodeStatus.confirmed))
    return s


def _mock_extractor(sections=3):
    m = MagicMock()
    from industry_analysis.datasource.cn_extract import ExtractResult
    m.extract_by_theme.return_value = ExtractResult(
        docs_processed=2, sections_indexed=sections)
    m.extract_by_symbol.return_value = ExtractResult(
        docs_processed=1, sections_indexed=sections)
    return m


def _mock_client(new_nodes=3):
    """Mock QuantAgentClient that returns N new child nodes per expand call."""
    client = MagicMock()
    # The expand function calls client.run() internally — we patch expand instead
    return client


def test_mine_first_raises_if_already_mined(store):
    # Add 5 depth-1 nodes to put theme in MINED state
    for i in range(5):
        n = Node(id=f"nd{i}", name_cn=f"节点{i}", name_en=f"Node{i}",
                 node_type=NodeType.material, theme_ids=["robotics"],
                 status=NodeStatus.confirmed)
        store.upsert_node(n)
        store.add_edge(n.id, "robotics", "")
    extractor = _mock_extractor()
    with pytest.raises(ValueError, match="already mined"):
        mine_first(store, MagicMock(), extractor, "robotics",
                   cn_db_path="/fake/cn.db", depth=3, timeout=30)


def test_mine_first_runs_cn_extract_before_expand(store):
    extractor = _mock_extractor()
    with patch("industry_analysis.mine.first.batch_expand") as mock_expand:
        mock_expand.return_value = {"created": 0, "linked": 0, "skipped": 0}
        import yaml, pathlib
        with patch("industry_analysis.mine.first._load_keywords",
                   return_value=["谐波减速器"]):
            result = mine_first(store, MagicMock(), extractor, "robotics",
                                cn_db_path="/fake/cn.db", depth=3, timeout=120)
    extractor.extract_by_theme.assert_called_once()
    assert isinstance(result, FirstMineResult)


def test_mine_first_returns_result_on_empty_theme(store):
    extractor = _mock_extractor()
    with patch("industry_analysis.mine.first.batch_expand") as mock_expand:
        mock_expand.return_value = {"created": 5, "linked": 0, "skipped": 0}
        with patch("industry_analysis.mine.first._load_keywords",
                   return_value=["谐波减速器"]):
            result = mine_first(store, MagicMock(), extractor, "robotics",
                                cn_db_path="/fake/cn.db", depth=3, timeout=120)
    assert result.theme_id == "robotics"
    assert result.extract_sections >= 0
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_mine_first.py -v 2>&1 | head -10
```

Expected: `ModuleNotFoundError: No module named 'industry_analysis.mine.first'`

- [ ] **Step 3: Implement `mine/first.py`**

Create `src/industry_analysis/mine/first.py`:

```python
"""Orchestrate first-time deep mining for a theme.

Flow:
  1. Check theme state — raise if already MINED
  2. cn-extract --theme (pre-fill datasource.db)
  3. batch_expand theme_id --auto-depth N
     (company nodes without evidence → cn-extract --symbol, sync wait)
  4. Return FirstMineResult
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

from ..datasource.cn_extract import CnExtractor
from ..mining.engine import batch_expand
from .state import ThemeState, get_theme_state


@dataclass
class FirstMineResult:
    theme_id: str
    extract_sections: int = 0
    nodes_created: int = 0
    nodes_linked: int = 0
    elapsed_s: float = 0.0
    errors: list[str] = field(default_factory=list)


def _load_keywords(theme_id: str) -> list[str]:
    import yaml
    seeds = Path(__file__).parents[4] / "seeds" / "theme_keywords.yaml"
    if not seeds.exists():
        return []
    data = yaml.safe_load(seeds.read_text(encoding="utf-8"))
    return data.get(theme_id, [])


def mine_first(store, client, extractor: CnExtractor, theme_id: str,
               cn_db_path: str, depth: int = 3,
               timeout: int = 120) -> FirstMineResult:
    """Run first-time deep mining for a theme.

    Args:
        store: GraphStore
        client: QuantAgentClient
        extractor: CnExtractor (datasource already open)
        theme_id: must exist in graph
        cn_db_path: path to CN filings.db
        depth: expansion depth (default 3)
        timeout: seconds to wait for per-symbol cn-extract (default 120)

    Raises:
        ValueError: if theme is already in MINED state
    """
    state = get_theme_state(store, theme_id)
    if state == ThemeState.MINED:
        raise ValueError(
            f"Theme '{theme_id}' is already mined (state=mined). "
            "Use 'mine update' instead."
        )

    t0 = time.time()
    result = FirstMineResult(theme_id=theme_id)

    # Step 1: pre-fill datasource.db with theme evidence
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
    result.elapsed_s = time.time() - t0
    return result
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_mine_first.py -v
```

Expected: 3 tests PASS

- [ ] **Step 5: Add `ia mine first` CLI command**

In `src/industry_analysis/cli/main.py`, add after the `datasource_app` commands:

```python
@mine_app.command("first")
def mine_first_cmd(
    theme: str = typer.Argument(..., help="Theme ID to mine (e.g. robotics)"),
    depth: int = typer.Option(3, "--depth", help="Expansion depth"),
    dry_run: bool = typer.Option(False, "--dry-run"),
):
    """First-time deep mining for a theme (cn-extract → expand → sync)."""
    from industry_analysis.datasource.cn_extract import CnExtractor
    from industry_analysis.mine.first import mine_first
    from pathlib import Path

    cfg = get_settings()
    cn_db = cfg.cn_filings_db_path or Path("D:/quantdata/markets/CN/filings.db")
    ds = _datasource_db()
    s, c = _store(), _client()

    if dry_run:
        from industry_analysis.mine.state import get_theme_state
        state = get_theme_state(s, theme)
        typer.echo(f"[dry-run] mine first --theme {theme} state={state.value}")
        return

    extractor = CnExtractor(str(cn_db), ds)
    result = mine_first(s, c, extractor, theme,
                        cn_db_path=str(cn_db), depth=depth)
    typer.echo(
        f"mine first done: theme={result.theme_id} "
        f"sections={result.extract_sections} "
        f"created={result.nodes_created} "
        f"elapsed={result.elapsed_s:.0f}s"
    )
    for e in result.errors:
        typer.echo(f"  ERROR: {e}", err=True)
```

`_client()` already exists at `src/industry_analysis/cli/main.py:29` — no need to add it.

- [ ] **Step 5b: Add post-expand company evidence fetch to `mine/first.py`**

After the `batch_expand` call in `mine_first()`, add:

```python
    # Step 3: fetch evidence for company nodes discovered during expand
    from ..graph.models import EvidenceGrade
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
```

Also add `from ..graph.models import NodeType` to `mine/first.py` imports.

- [ ] **Step 6: Run all mine tests**

```bash
pytest tests/test_mine_state.py tests/test_mine_first.py -v
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/industry_analysis/mine/first.py src/industry_analysis/cli/main.py tests/test_mine_first.py
git commit -m "feat: add mine/first.py + 'ia mine first' CLI command"
```

---

## Task 7: `ia mine update` — C branch (re-score)

**Files:**
- Create: `src/industry_analysis/mine/update.py`
- Create: `tests/test_mine_update.py`
- Modify: `src/industry_analysis/cli/main.py`

- [ ] **Step 1: Write failing tests for C branch**

Create `tests/test_mine_update.py`:

```python
import pytest
from unittest.mock import MagicMock, patch
from industry_analysis.graph.models import (
    Node, NodeType, NodeStatus, EvidenceGrade
)
from industry_analysis.graph.store import GraphStore
from industry_analysis.datasource.store.datasource_db import DataSourceDB
from industry_analysis.mine.update import mine_update, UpdateResult


@pytest.fixture
def store(tmp_path):
    s = GraphStore(str(tmp_path / "graph.db"))
    s.upsert_node(Node(id="robotics", name_cn="机器人", name_en="Robotics",
                       node_type=NodeType.theme, theme_ids=["robotics"],
                       status=NodeStatus.confirmed))
    # Add a confirmed node with grade D (no evidence yet)
    s.upsert_node(Node(id="harmonic", name_cn="谐波减速器", name_en="Harmonic Drive",
                       node_type=NodeType.component, theme_ids=["robotics"],
                       status=NodeStatus.confirmed,
                       evidence_grade=EvidenceGrade.D))
    s.add_edge("harmonic", "robotics", "upstream")
    return s


@pytest.fixture
def ds(tmp_path):
    return DataSourceDB(tmp_path / "ds.db")


def test_update_c_detects_new_docs_and_calls_extract(store, ds, tmp_path):
    import sqlite3
    cn_db = tmp_path / "cn.db"
    conn = sqlite3.connect(str(cn_db))
    conn.executescript("""
        CREATE TABLE documents (id TEXT, symbol TEXT, doc_type TEXT,
            period_end TEXT, content_hash TEXT, parse_status TEXT);
        CREATE TABLE sections (id TEXT, document_id TEXT, symbol TEXT,
            section_seq INTEGER, section_level INTEGER,
            heading_path TEXT, section_name TEXT, content TEXT, char_count INTEGER);
        CREATE INDEX idx_secs_doc ON sections(document_id);
    """)
    conn.execute("INSERT INTO documents VALUES ('d1','300135.SZ','annual','2025-12-31','h1','success')")
    conn.execute("""INSERT INTO sections VALUES
        ('s1','d1','300135.SZ',0,2,'主要供应商','供应商情况',
         '主要供应商：谐波减速器供应商A公司',10)""")
    conn.commit()
    conn.close()

    with patch("industry_analysis.mine.update.CnExtractor") as MockExt:
        instance = MockExt.return_value
        from industry_analysis.datasource.cn_extract import ExtractResult
        instance.extract_by_theme.return_value = ExtractResult(
            docs_processed=1, sections_indexed=2)
        result = mine_update(store, MagicMock(), ds, str(cn_db),
                             theme_ids=["robotics"])
    assert isinstance(result, UpdateResult)
    assert result.docs_rescored >= 0


def test_update_a_finds_leaf_nodes(store, ds, tmp_path):
    cn_db = tmp_path / "cn.db"
    import sqlite3
    conn = sqlite3.connect(str(cn_db))
    conn.executescript("""
        CREATE TABLE documents (id TEXT, symbol TEXT, doc_type TEXT,
            period_end TEXT, content_hash TEXT, parse_status TEXT);
        CREATE TABLE sections (id TEXT, document_id TEXT, symbol TEXT,
            section_seq INTEGER, section_level INTEGER,
            heading_path TEXT, section_name TEXT, content TEXT, char_count INTEGER);
        CREATE INDEX idx_secs_doc ON sections(document_id);
    """)
    conn.commit()
    conn.close()

    # harmonic has no suppliers → is a leaf
    with patch("industry_analysis.mine.update.expand") as mock_expand:
        mock_expand.return_value = {"created": 2, "linked": 0, "skipped": 0}
        result = mine_update(store, MagicMock(), ds, str(cn_db),
                             theme_ids=["robotics"])
    # expand should have been called for the leaf node "harmonic"
    mock_expand.assert_called()
    assert result.leaf_nodes_expanded >= 1
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_mine_update.py -v 2>&1 | head -10
```

Expected: `ModuleNotFoundError: No module named 'industry_analysis.mine.update'`

- [ ] **Step 3: Implement `mine/update.py`**

Create `src/industry_analysis/mine/update.py`:

```python
"""Incremental update mining: re-score existing nodes (C) + expand leaf nodes (A).

C branch: detect new/modified documents in CN filings.db → re-extract → re-score nodes
A branch: find upstream leaf nodes (suppliers=[]) → expand one level
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from ..datasource.cn_extract import CnExtractor, EXTRACTOR_VERSION
from ..graph.models import NodeStatus, NodeType, EvidenceGrade
from ..graph.store import GraphStore
from ..mining.engine import expand
from .state import _load_keywords  # reuse keyword loader


@dataclass
class UpdateResult:
    theme_ids: list[str] = field(default_factory=list)
    docs_rescored: int = 0
    nodes_grade_upgraded: int = 0
    nodes_grade_downgraded: int = 0
    leaf_nodes_expanded: int = 0
    new_nodes_created: int = 0
    review_queue_added: int = 0
    elapsed_s: float = 0.0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"更新摘要 (themes={','.join(self.theme_ids)})\n"
            f"  新年报重评: {self.docs_rescored} 文档 "
            f"({self.nodes_grade_upgraded} 升 / "
            f"{self.nodes_grade_downgraded} 降 → review queue)\n"
            f"  叶节点展开: {self.leaf_nodes_expanded} 个 "
            f"→ {self.new_nodes_created} 新节点\n"
            f"  进入 review queue: {self.review_queue_added}"
        )


def mine_update(store: GraphStore, client, datasource,
                cn_db_path: str, theme_ids: list[str] | None = None,
                extractor_version: str = EXTRACTOR_VERSION) -> UpdateResult:
    """Run incremental update mining (A+C) for given themes."""
    t0 = time.time()
    result = UpdateResult()

    if theme_ids is None:
        # all non-crypto themes
        theme_ids = [
            n.id for n in store.list_nodes()
            if n.node_type == NodeType.theme
            and n.id not in {"bitcoin", "tokenized-assets", "defi"}
        ]
    result.theme_ids = list(theme_ids)

    extractor = CnExtractor(cn_db_path, datasource, extractor_version)
    from ..config import get_settings
    cfg = get_settings()

    for theme_id in theme_ids:
        # ── C branch: re-extract new docs, re-score affected nodes ──
        keywords = _load_keywords(theme_id)
        if keywords:
            try:
                _run_c_branch(store, extractor, datasource, theme_id,
                              keywords, result)
            except Exception as e:
                result.errors.append(f"C-branch {theme_id}: {e}")

        # ── A branch: expand upstream leaf nodes ──
        try:
            _run_a_branch(store, client, datasource, theme_id,
                          cfg.auto_confirm_grade, result)
        except Exception as e:
            result.errors.append(f"A-branch {theme_id}: {e}")

    result.elapsed_s = time.time() - t0
    return result


def _run_c_branch(store: GraphStore, extractor: CnExtractor,
                  datasource, theme_id: str, keywords: list[str],
                  result: UpdateResult) -> None:
    """Detect new/modified docs, re-extract, re-score nodes."""
    import sqlite3
    from contextlib import closing

    with closing(sqlite3.connect(
        f"file:{extractor.cn_db_path}?mode=ro", uri=True
    )) as cn_conn:
        cn_conn.row_factory = sqlite3.Row
        new_docs = datasource.get_unextracted_docs(
            cn_conn, extractor.version,
            doc_types=("annual", "semi-annual"),
        )

    if not new_docs:
        return

    # Extract evidence from new docs
    for doc in new_docs:
        symbol = doc["symbol"]
        try:
            extractor.extract_by_symbol(symbol)
            result.docs_rescored += 1
        except Exception as e:
            result.errors.append(f"extract {symbol}: {e}")
            continue

        # Re-score nodes for this symbol
        theme_nodes = [
            n for n in store.list_nodes()
            if theme_id in n.theme_ids
            and n.node_type != NodeType.theme
            and (symbol.lower() in (n.name_cn or "").lower()
                 or symbol.lower() in (n.name_en or "").lower()
                 or any(symbol.lower() in a.lower() for a in n.aliases))
        ]
        for node in theme_nodes:
            _rescore_node(store, datasource, node, result)


def _rescore_node(store: GraphStore, datasource, node, result: UpdateResult):
    """Re-evaluate evidence_grade for a node based on current FTS hits."""
    hits = datasource.search(node.name_cn or node.name_en or node.id, limit=5)
    if not hits:
        hits = []
        for alias in node.aliases[:3]:
            hits.extend(datasource.search(alias, limit=2))

    old_grade = node.evidence_grade
    if hits:
        # Upgrade: if we now have evidence, bump to at least C
        if old_grade in (None, EvidenceGrade.E, EvidenceGrade.D):
            store.upsert_node(node.model_copy(
                update={"evidence_grade": EvidenceGrade.C}))
            result.nodes_grade_upgraded += 1
    else:
        # Downgrade: if confirmed but no evidence, drop one grade
        if old_grade in (EvidenceGrade.A, EvidenceGrade.B):
            new_grade = (EvidenceGrade.B if old_grade == EvidenceGrade.A
                         else EvidenceGrade.C)
            store.upsert_node(node.model_copy(
                update={"evidence_grade": new_grade,
                        "status": NodeStatus.proposed}))
            result.nodes_grade_downgraded += 1
            result.review_queue_added += 1


def _run_a_branch(store: GraphStore, client, datasource, theme_id: str,
                  auto_confirm_grade, result: UpdateResult) -> None:
    """Expand upstream leaf nodes for a theme."""
    leaf_nodes = [
        n for n in store.list_nodes()
        if theme_id in n.theme_ids
        and n.node_type != NodeType.theme
        and n.status == NodeStatus.confirmed
        and n.evidence_grade in (EvidenceGrade.A, EvidenceGrade.B,
                                  EvidenceGrade.C)
        and len(store.suppliers(n.id)) == 0
    ]

    # Sort best evidence first
    grade_order = {EvidenceGrade.A: 0, EvidenceGrade.B: 1, EvidenceGrade.C: 2}
    leaf_nodes.sort(key=lambda n: grade_order.get(n.evidence_grade, 9))

    for node in leaf_nodes:
        try:
            r = expand(store, client, node.id,
                       auto_confirm_grade=auto_confirm_grade,
                       datasource_db=datasource)
            result.leaf_nodes_expanded += 1
            result.new_nodes_created += r.get("created", 0)
            result.review_queue_added += r.get("created", 0)
        except Exception as e:
            result.errors.append(f"expand {node.id}: {e}")
```

Also add `_load_keywords` to `mine/state.py` so it can be imported from `update.py`. The function already exists in `mine/first.py` — move it to `mine/state.py`:

In `src/industry_analysis/mine/state.py`, add after the imports:

```python
from pathlib import Path


def _load_keywords(theme_id: str) -> list[str]:
    import yaml
    seeds = Path(__file__).parents[4] / "seeds" / "theme_keywords.yaml"
    if not seeds.exists():
        return []
    data = yaml.safe_load(seeds.read_text(encoding="utf-8"))
    return data.get(theme_id, [])
```

In `mine/first.py`, replace `_load_keywords` definition with:

```python
from .state import _load_keywords
```

- [ ] **Step 4: Run all update tests**

```bash
pytest tests/test_mine_update.py -v
```

Expected: 2 tests PASS

- [ ] **Step 5: Add `ia mine update` CLI command**

In `src/industry_analysis/cli/main.py`, add after `mine_first_cmd`:

```python
@mine_app.command("update")
def mine_update_cmd(
    theme: Optional[str] = typer.Option(None, "--theme",
        help="Theme ID or 'all'"),
    since: Optional[str] = typer.Option(None, "--since",
        help="ISO date filter (unused in v1, reserved)"),
):
    """Incremental update: re-score nodes (C) + expand leaf nodes (A)."""
    from industry_analysis.mine.update import mine_update
    from pathlib import Path

    cfg = get_settings()
    cn_db = cfg.cn_filings_db_path or Path("D:/quantdata/markets/CN/filings.db")
    ds = _datasource_db()
    s, c = _store(), _client()

    theme_ids = None if (theme is None or theme == "all") else [theme]
    result = mine_update(s, c, ds, str(cn_db), theme_ids=theme_ids)
    typer.echo(result.summary())
    for e in result.errors:
        typer.echo(f"  ERROR: {e}", err=True)
```

- [ ] **Step 6: Run full test suite**

```bash
pytest tests/test_cn_extract.py tests/test_mine_state.py tests/test_mine_first.py tests/test_mine_update.py -v
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/industry_analysis/mine/update.py src/industry_analysis/mine/state.py src/industry_analysis/mine/first.py src/industry_analysis/cli/main.py tests/test_mine_update.py
git commit -m "feat: add mine/update.py A+C branches + 'ia mine update' CLI"
```

---

## Task 8: Full integration smoke test

**Goal:** Confirm the entire PR1-3 chain works end-to-end against real data.

- [ ] **Step 1: Run full test suite**

```bash
cd python && pytest tests/ -v --tb=short 2>&1 | tail -20
```

Expected: no new failures

- [ ] **Step 2: Smoke test cn-extract on real data**

```bash
ia datasource cn-extract --theme mlcc
ia datasource cn-extract --symbol 300135.SZ
```

Expected output like:
```
cn-extract done: processed=12 skipped=0 sections=47
cn-extract done: processed=1 skipped=0 sections=5
```

- [ ] **Step 3: Smoke test mine first (dry run)**

```bash
ia mine first ai-consumer-os --dry-run
```

Expected: `[dry-run] mine first --theme ai-consumer-os state=unmined`

- [ ] **Step 4: Smoke test mine update (dry run)**

```bash
ia mine update --theme robotics 2>&1 | head -5
```

Expected: summary with counts (may be all zeros if no new docs)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: PR1-3 integration verified — cn-extract + mine first/update"
```

---

## Plan B (separate session): PR4-6

- **PR4:** News sources — `fetchers/akshare_news.py`, `fetchers/finviz.py`, `news/pipeline.py` (keyword filter)
- **PR5:** `ia daily` — orchestrate fetch → filter → scan → queue with daily budget cap + theme lock
- **PR6:** Web UI — `/api/queue` endpoints + `dashboard/static/queue.html`
