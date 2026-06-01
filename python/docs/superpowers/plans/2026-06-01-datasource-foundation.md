# DataSource Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the self-contained datasource foundation: config/models, shared FilingsDB, DataSourceDB with FTS5, PDF extractor, CN sections parser, CN mentions extractor, cninfo connector, and edgartools-based US connector.

**Architecture:** Three SQLite files (`CN/filings.db`, `US/filings.db`, `datasource.db`) under a configurable cache dir. FilingsDB is a shared schema for both markets. DataSourceDB holds companies + mentions + FTS5 trigram index. CN uses pdfplumber/pdfminer.six for PDF→text→sections→mentions. US uses `edgartools` (MIT, 2.3k★) which handles EDGAR HTML directly — no PDF pipeline needed.

**Tech Stack:** Python 3.11+, sqlite3, pydantic-settings, pdfminer.six, edgartools>=5.0, httpx, typer.

**Spec:** `docs/superpowers/specs/2026-06-01-datasource-design.md`

**Review changes applied (post Codex + Gemini):**
- `documents` table: 3 independent status fields (`download_status / extract_status / index_status`) instead of 1 `parse_status` — enables Plan 2 worker idempotency
- `MentionCandidate.match_type` (`full_name / short_name / context`) — makes recall quality measurable
- Task 8: `EdgarToolsConnector` wraps edgartools instead of raw SEC API — section extraction included, no PDF needed for US

---

## File Structure

```
src/industry_analysis/datasource/
  __init__.py
  config.py            # DataSourceSettings (IA_DATASOURCE_* prefix)
  models.py            # all dataclasses (DocumentRecord, SectionRecord, ...)
  store/
    __init__.py
    filings_db.py      # FilingsDB — shared schema for CN + US
    datasource_db.py   # DataSourceDB — companies + mentions + FTS5
  extractor/
    __init__.py
    pdf.py             # extract_text_from_pdf(bytes) -> str  [CN only]
    sections.py        # parse_sections_cn(text, ...) -> list[SectionRecord]
    mentions.py        # extract_mentions(sections) -> list[MentionCandidate]
  connectors/
    __init__.py
    base.py            # BaseConnector ABC
    cninfo.py          # CninfoConnector — list + download from 巨潮
    edgartools_conn.py # EdgarToolsConnector — wraps edgartools for 10-K/S-1

tests/
  test_datasource_config.py
  test_filings_db.py
  test_datasource_db.py
  test_pdf_extractor.py
  test_sections_parser.py
  test_mentions_extractor.py
  test_cninfo_connector.py
  test_edgartools_connector.py
```

**Modify:** `pyproject.toml` — add `pdfminer.six>=20221105` and `edgartools>=5.0`

---

## Task 1: pyproject + config + models

**Files:**
- Modify: `pyproject.toml`
- Create: `src/industry_analysis/datasource/__init__.py` (empty)
- Create: `src/industry_analysis/datasource/config.py`
- Create: `src/industry_analysis/datasource/models.py`
- Create: `tests/test_datasource_config.py`

- [ ] **Step 1: Add deps to `pyproject.toml`**

In the `dependencies` list add:
```toml
    "pdfminer.six>=20221105",
    "edgartools>=5.0",
```

- [ ] **Step 2: Write failing test**

```python
# tests/test_datasource_config.py
from pathlib import Path
from industry_analysis.datasource.config import DataSourceSettings

def test_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("IA_DATASOURCE_CACHE_DIR", str(tmp_path / "ds"))
    s = DataSourceSettings()
    assert s.cache_dir == tmp_path / "ds"
    assert s.cn_filings_db is None
    assert s.cn_filings_db_path == tmp_path / "ds" / "CN" / "filings.db"
    assert s.us_filings_db_path == tmp_path / "ds" / "US" / "filings.db"
    assert s.datasource_db_path == tmp_path / "ds" / "datasource.db"

def test_override_cn_filings_db(tmp_path, monkeypatch):
    custom = tmp_path / "existing.db"
    monkeypatch.setenv("IA_DATASOURCE_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("IA_DATASOURCE_CN_FILINGS_DB", str(custom))
    s = DataSourceSettings()
    assert s.cn_filings_db_path == custom
```

- [ ] **Step 3: Run to confirm failure**

```
.venv\Scripts\python.exe -m pytest tests/test_datasource_config.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 4: Create `src/industry_analysis/datasource/__init__.py`** (empty)

- [ ] **Step 5: Create `src/industry_analysis/datasource/config.py`**

```python
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class DataSourceSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="IA_DATASOURCE_", env_file=".env", extra="ignore"
    )

    cache_dir: Path = Path("data/datasource")
    cn_filings_db: Path | None = None   # None = auto-build at cache_dir/CN/filings.db
    sec_user_agent: str = "IndustryAnalysis/1.0 contact@example.com"
    cn_rate_limit: float = 1.0
    sec_rate_limit: float = 0.12

    @property
    def cn_filings_db_path(self) -> Path:
        return self.cn_filings_db if self.cn_filings_db else self.cache_dir / "CN" / "filings.db"

    @property
    def us_filings_db_path(self) -> Path:
        return self.cache_dir / "US" / "filings.db"

    @property
    def datasource_db_path(self) -> Path:
        return self.cache_dir / "datasource.db"


def get_datasource_settings() -> DataSourceSettings:
    return DataSourceSettings()
```

- [ ] **Step 6: Create `src/industry_analysis/datasource/models.py`**

```python
from dataclasses import dataclass, field
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class DocumentRecord:
    id: str                           # {symbol}_{doc_type}_{period_end}
    symbol: str
    doc_type: str                     # annual/prospectus/10-K/S-1/q1/h1
    period_end: str | None = None
    report_period: str | None = None
    publish_date: str | None = None
    title: str | None = None
    source_url: str | None = None
    local_path: str | None = None
    # Three independent status fields — enables worker idempotency (Plan 2)
    download_status: str = "pending"  # pending/success/failed
    extract_status: str = "pending"   # pending/success/failed_corrupt/failed_ocr
    index_status: str = "pending"     # pending/success/failed
    downloaded_at: str | None = None
    extracted_at: str | None = None
    indexed_at: str | None = None
    updated_at: str = field(default_factory=_now)


@dataclass
class SectionRecord:
    document_id: str
    symbol: str
    section_seq: int
    section_level: int
    heading_path: str
    section_name: str
    content: str
    char_count: int = 0

    def __post_init__(self):
        if not self.char_count:
            self.char_count = len(self.content)


@dataclass
class CompanyRecord:
    id: str                           # normalize(name) slug
    name: str
    name_en: str | None = None
    ticker: str | None = None         # None for unlisted companies
    exchange: str | None = None
    is_listed: bool = False
    country: str = "CN"
    aliases: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now)


@dataclass
class FilingRecord:
    id: str                           # {source}:{source_id}
    company_id: str | None
    filer_name: str | None
    filing_type: str                  # annual/prospectus/10-K/S-1
    period_end: str | None
    source: str                       # cn_filings / us_filings
    source_id: str
    source_url: str | None = None
    indexed_at: str = field(default_factory=_now)


@dataclass
class MentionCandidate:
    """Raw extraction result — a candidate, not verified fact."""
    mentioned_name: str
    mention_type: str                 # supplier/customer/competitor/investee/other
    context: str
    section_path: str
    confidence: float = 1.0
    match_type: str = "full_name"     # full_name / short_name / context
    # full_name: matched 有限公司/Inc. suffix → higher confidence
    # short_name: matched known short form → medium confidence
    # context: inferred from surrounding text → lower confidence


@dataclass
class MentionRecord:
    filing_id: str
    mentioned_name: str
    company_id: str | None
    mention_type: str
    context: str
    section_path: str
    match_type: str = "full_name"
    confidence: float = 1.0
    created_at: str = field(default_factory=_now)


@dataclass
class SearchResult:
    filing_id: str
    company_id: str | None
    filer_name: str | None
    section_path: str
    snippet: str


@dataclass
class CompanyProfile:
    company: CompanyRecord
    filings: list[FilingRecord]
    mention_counts: dict[str, int]    # mention_type -> count
```

- [ ] **Step 7: Run tests**

```
.venv\Scripts\python.exe -m pytest tests/test_datasource_config.py -v
```
Expected: 2 passed

- [ ] **Step 8: Install new deps**

```
.venv\Scripts\python.exe -m pip install "pdfminer.six>=20221105" "edgartools>=5.0"
```

- [ ] **Step 9: Commit**

```bash
git add pyproject.toml src/industry_analysis/datasource/ tests/test_datasource_config.py
git commit -m "feat: datasource config + models (3-status fields, match_type)"
```

---

## Task 2: FilingsDB — shared schema + document CRUD

**Files:**
- Create: `src/industry_analysis/datasource/store/__init__.py` (empty)
- Create: `src/industry_analysis/datasource/store/filings_db.py`
- Create: `tests/test_filings_db.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_filings_db.py
import pytest
from industry_analysis.datasource.store.filings_db import FilingsDB
from industry_analysis.datasource.models import DocumentRecord, SectionRecord


@pytest.fixture
def db(tmp_path):
    return FilingsDB(tmp_path / "test.db")


def _doc(**kw) -> DocumentRecord:
    base = dict(id="600519.SH_annual_2025-12-31", symbol="600519.SH",
                doc_type="annual", period_end="2025-12-31")
    base.update(kw)
    return DocumentRecord(**base)


def test_upsert_get_roundtrip(db):
    doc = _doc(title="贵州茅台2025年报")
    db.upsert_document(doc)
    got = db.get_document(doc.id)
    assert got.symbol == "600519.SH"
    assert got.download_status == "pending"
    assert got.extract_status == "pending"
    assert got.index_status == "pending"


def test_update_download_status(db):
    db.upsert_document(_doc())
    db.set_download_status(
        "600519.SH_annual_2025-12-31", "success",
        downloaded_at="2026-01-01T00:00:00", local_path="/tmp/a.pdf"
    )
    got = db.get_document("600519.SH_annual_2025-12-31")
    assert got.download_status == "success"
    assert got.local_path == "/tmp/a.pdf"


def test_update_extract_status(db):
    db.upsert_document(_doc())
    db.set_extract_status("600519.SH_annual_2025-12-31", "failed_ocr")
    assert db.get_document("600519.SH_annual_2025-12-31").extract_status == "failed_ocr"


def test_find_by_status(db):
    db.upsert_document(_doc(id="a", symbol="600519.SH", period_end="2025"))
    db.upsert_document(_doc(id="b", symbol="600519.SH", period_end="2024"))
    db.set_extract_status("a", "success")
    pending = db.find_documents(extract_status="pending")
    assert {d.id for d in pending} == {"b"}


def test_replace_sections(db):
    db.upsert_document(_doc())
    secs = [SectionRecord("600519.SH_annual_2025-12-31", "600519.SH", 0, 1,
                           "第三节/主营业务", "主营业务", "公司主要从事...", 0)]
    db.replace_sections("600519.SH_annual_2025-12-31", secs)
    got = db.get_sections("600519.SH_annual_2025-12-31")
    assert len(got) == 1
    assert got[0].heading_path == "第三节/主营业务"


def test_sections_heading_filter(db):
    db.upsert_document(_doc())
    secs = [
        SectionRecord("600519.SH_annual_2025-12-31", "600519.SH", 0, 1,
                       "第三节/主营业务", "主营业务", "主营内容", 0),
        SectionRecord("600519.SH_annual_2025-12-31", "600519.SH", 1, 2,
                       "第三节/主要供应商", "主要供应商", "供应商列表", 0),
    ]
    db.replace_sections("600519.SH_annual_2025-12-31", secs)
    filtered = db.get_sections("600519.SH_annual_2025-12-31", heading_filter=["供应商"])
    assert len(filtered) == 1


def test_readonly_mode(tmp_path):
    path = tmp_path / "r.db"
    w = FilingsDB(path)
    w.upsert_document(_doc())
    r = FilingsDB(path, readonly=True)
    assert r.get_document("600519.SH_annual_2025-12-31") is not None
    with pytest.raises(PermissionError):
        r.upsert_document(_doc(id="BLOCKED"))
```

- [ ] **Step 2: Run to confirm failure**

```
.venv\Scripts\python.exe -m pytest tests/test_filings_db.py -v
```

- [ ] **Step 3: Create `src/industry_analysis/datasource/store/filings_db.py`**

```python
import sqlite3
from contextlib import closing
from pathlib import Path

from ..models import DocumentRecord, SectionRecord

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id              TEXT PRIMARY KEY,
    symbol          TEXT NOT NULL,
    doc_type        TEXT NOT NULL,
    period_end      TEXT,
    report_period   TEXT,
    publish_date    TEXT,
    title           TEXT,
    source_url      TEXT,
    local_path      TEXT,
    download_status TEXT DEFAULT 'pending',
    extract_status  TEXT DEFAULT 'pending',
    index_status    TEXT DEFAULT 'pending',
    downloaded_at   TEXT,
    extracted_at    TEXT,
    indexed_at      TEXT,
    updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_doc_sym      ON documents(symbol, doc_type, period_end);
CREATE INDEX IF NOT EXISTS idx_doc_dlstatus ON documents(download_status);
CREATE INDEX IF NOT EXISTS idx_doc_exstatus ON documents(extract_status);
CREATE INDEX IF NOT EXISTS idx_doc_ixstatus ON documents(index_status);

CREATE TABLE IF NOT EXISTS sections (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id   TEXT NOT NULL REFERENCES documents(id),
    symbol        TEXT NOT NULL,
    section_seq   INTEGER DEFAULT 0,
    section_level INTEGER DEFAULT 1,
    heading_path  TEXT,
    section_name  TEXT,
    content       TEXT,
    char_count    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sec_doc ON sections(document_id);
CREATE INDEX IF NOT EXISTS idx_sec_sym ON sections(symbol);

CREATE TABLE IF NOT EXISTS announcements (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol       TEXT NOT NULL,
    ann_type     TEXT,
    title        TEXT,
    publish_date TEXT,
    source_url   TEXT,
    full_text    TEXT,
    updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_ann_sym ON announcements(symbol, publish_date);
"""


class FilingsDB:
    def __init__(self, path: Path, readonly: bool = False):
        self.path = Path(path)
        self._readonly = readonly
        if not readonly:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with closing(self._conn()) as conn:
                conn.executescript(_SCHEMA)
                conn.commit()

    def _conn(self) -> sqlite3.Connection:
        if self._readonly:
            uri = f"file:{self.path}?mode=ro"
            conn = sqlite3.connect(uri, uri=True, timeout=10, check_same_thread=False)
        else:
            conn = sqlite3.connect(str(self.path), timeout=10, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    # ── Documents ─────────────────────────────────────────────────────────────

    def upsert_document(self, doc: DocumentRecord) -> str:
        if self._readonly:
            raise PermissionError("FilingsDB opened in readonly mode")
        sql = """INSERT INTO documents
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET
                   local_path=COALESCE(excluded.local_path, local_path),
                   updated_at=excluded.updated_at"""
        with closing(self._conn()) as conn:
            conn.execute(sql, (
                doc.id, doc.symbol, doc.doc_type, doc.period_end,
                doc.report_period, doc.publish_date, doc.title,
                doc.source_url, doc.local_path,
                doc.download_status, doc.extract_status, doc.index_status,
                doc.downloaded_at, doc.extracted_at, doc.indexed_at,
                doc.updated_at,
            ))
            conn.commit()
        return doc.id

    def get_document(self, doc_id: str) -> DocumentRecord | None:
        with closing(self._conn()) as conn:
            row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
        return _doc_from_row(row) if row else None

    def find_documents(self, symbol: str | None = None, doc_type: str | None = None,
                       download_status: str | None = None,
                       extract_status: str | None = None,
                       index_status: str | None = None) -> list[DocumentRecord]:
        q, params = "SELECT * FROM documents WHERE 1=1", []
        if symbol:
            q += " AND symbol=?"; params.append(symbol)
        if doc_type:
            q += " AND doc_type=?"; params.append(doc_type)
        if download_status:
            q += " AND download_status=?"; params.append(download_status)
        if extract_status:
            q += " AND extract_status=?"; params.append(extract_status)
        if index_status:
            q += " AND index_status=?"; params.append(index_status)
        q += " ORDER BY period_end DESC"
        with closing(self._conn()) as conn:
            rows = conn.execute(q, params).fetchall()
        return [_doc_from_row(r) for r in rows]

    def set_download_status(self, doc_id: str, status: str,
                             downloaded_at: str | None = None,
                             local_path: str | None = None):
        with closing(self._conn()) as conn:
            conn.execute(
                "UPDATE documents SET download_status=?, downloaded_at=?,"
                " local_path=COALESCE(?, local_path) WHERE id=?",
                (status, downloaded_at, local_path, doc_id),
            )
            conn.commit()

    def set_extract_status(self, doc_id: str, status: str, extracted_at: str | None = None):
        with closing(self._conn()) as conn:
            conn.execute(
                "UPDATE documents SET extract_status=?, extracted_at=? WHERE id=?",
                (status, extracted_at, doc_id),
            )
            conn.commit()

    def set_index_status(self, doc_id: str, status: str, indexed_at: str | None = None):
        with closing(self._conn()) as conn:
            conn.execute(
                "UPDATE documents SET index_status=?, indexed_at=? WHERE id=?",
                (status, indexed_at, doc_id),
            )
            conn.commit()

    # ── Sections ──────────────────────────────────────────────────────────────

    def replace_sections(self, document_id: str, sections: list[SectionRecord]):
        with closing(self._conn()) as conn:
            conn.execute("DELETE FROM sections WHERE document_id=?", (document_id,))
            for s in sections:
                conn.execute(
                    "INSERT INTO sections (document_id,symbol,section_seq,section_level,"
                    "heading_path,section_name,content,char_count) VALUES (?,?,?,?,?,?,?,?)",
                    (s.document_id, s.symbol, s.section_seq, s.section_level,
                     s.heading_path, s.section_name, s.content, s.char_count),
                )
            conn.commit()

    def get_sections(self, document_id: str,
                     heading_filter: list[str] | None = None) -> list[SectionRecord]:
        with closing(self._conn()) as conn:
            rows = conn.execute(
                "SELECT * FROM sections WHERE document_id=? ORDER BY section_seq",
                (document_id,),
            ).fetchall()
        sections = [_sec_from_row(r) for r in rows]
        if heading_filter:
            sections = [
                s for s in sections
                if any(kw in (s.heading_path or "") or kw in (s.section_name or "")
                       for kw in heading_filter)
            ]
        return sections


def _doc_from_row(r: sqlite3.Row) -> DocumentRecord:
    return DocumentRecord(
        id=r["id"], symbol=r["symbol"], doc_type=r["doc_type"],
        period_end=r["period_end"], report_period=r["report_period"],
        publish_date=r["publish_date"], title=r["title"],
        source_url=r["source_url"], local_path=r["local_path"],
        download_status=r["download_status"], extract_status=r["extract_status"],
        index_status=r["index_status"], downloaded_at=r["downloaded_at"],
        extracted_at=r["extracted_at"], indexed_at=r["indexed_at"],
        updated_at=r["updated_at"],
    )


def _sec_from_row(r: sqlite3.Row) -> SectionRecord:
    return SectionRecord(
        document_id=r["document_id"], symbol=r["symbol"],
        section_seq=r["section_seq"], section_level=r["section_level"],
        heading_path=r["heading_path"] or "", section_name=r["section_name"] or "",
        content=r["content"] or "", char_count=r["char_count"],
    )
```

- [ ] **Step 4: Run tests**

```
.venv\Scripts\python.exe -m pytest tests/test_filings_db.py -v
```
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/datasource/store/ tests/test_filings_db.py
git commit -m "feat: FilingsDB shared schema (3 status fields + sections)"
```

---

## Task 3: DataSourceDB — companies + mentions + FTS5

**Files:**
- Create: `src/industry_analysis/datasource/store/datasource_db.py`
- Create: `tests/test_datasource_db.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_datasource_db.py
import pytest
from industry_analysis.datasource.store.datasource_db import DataSourceDB
from industry_analysis.datasource.models import (
    CompanyRecord, FilingRecord, MentionRecord
)


@pytest.fixture
def db(tmp_path):
    return DataSourceDB(tmp_path / "ds.db")


def _company(**kw) -> CompanyRecord:
    base = dict(id="圣邦股份", name="圣邦股份", ticker="688036.SH",
                is_listed=True, aliases=["圣邦微", "SG Micro"])
    base.update(kw)
    return CompanyRecord(**base)


def _filing(company_id="圣邦股份") -> FilingRecord:
    return FilingRecord(id="cn:688036.SH_annual_2024-12-31",
                        company_id=company_id, filer_name="圣邦股份",
                        filing_type="annual", period_end="2024-12-31",
                        source="cn_filings", source_id="688036.SH_annual_2024-12-31")


def test_upsert_find_by_ticker(db):
    db.upsert_company(_company())
    assert db.find_company("688036.SH").name == "圣邦股份"


def test_find_by_name_id(db):
    db.upsert_company(_company())
    assert db.find_company("圣邦股份").ticker == "688036.SH"


def test_unlisted_company(db):
    db.upsert_company(CompanyRecord(id="某未上市材料", name="某未上市材料有限公司"))
    found = db.find_company("某未上市材料")
    assert found is not None
    assert not found.is_listed
    assert found.ticker is None


def test_upsert_filing_and_get(db):
    db.upsert_company(_company())
    db.upsert_filing(_filing())
    filings = db.get_filings("圣邦股份")
    assert len(filings) == 1
    assert filings[0].filing_type == "annual"


def test_insert_mention_with_match_type(db):
    db.upsert_company(_company())
    db.upsert_filing(_filing())
    m = MentionRecord(
        filing_id="cn:688036.SH_annual_2024-12-31",
        mentioned_name="某供应商有限公司", company_id=None,
        mention_type="supplier", context="前五大供应商包括某供应商有限公司",
        section_path="第三节/主要供应商", match_type="full_name",
    )
    db.insert_mention(m)
    results = db.get_mentions_of("某供应商有限公司")
    assert len(results) == 1
    assert results[0].match_type == "full_name"


def test_fts_trigram_chinese(db):
    db.upsert_company(_company())
    db.upsert_filing(_filing())
    db.fts_index("cn:688036.SH_annual_2024-12-31", "圣邦股份",
                 "第三节/主营业务",
                 "公司主要从事模拟芯片设计，产品包括Dr MOS电源管理芯片，主要应用于AI服务器")
    assert len(db.search("Dr MOS")) >= 1
    assert len(db.search("模拟芯片")) >= 1


def test_fts_trigram_supply_chain_keyword(db):
    db.upsert_company(_company())
    db.upsert_filing(_filing())
    db.fts_index("cn:688036.SH_annual_2024-12-31", "圣邦股份",
                 "第三节/供应商",
                 "主要供应商包括绿的谐波技术有限公司，提供谐波减速器零部件")
    assert len(db.search("谐波减速器")) >= 1
```

- [ ] **Step 2: Run to confirm failure**

```
.venv\Scripts\python.exe -m pytest tests/test_datasource_db.py -v
```

- [ ] **Step 3: Create `src/industry_analysis/datasource/store/datasource_db.py`**

```python
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from ..models import CompanyRecord, FilingRecord, MentionRecord, SearchResult
from ...graph.models import normalize

_SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    name_en    TEXT,
    ticker     TEXT,
    exchange   TEXT,
    is_listed  INTEGER DEFAULT 0,
    country    TEXT DEFAULT 'CN',
    aliases    TEXT DEFAULT '[]',
    sources    TEXT DEFAULT '[]',
    created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_co_ticker ON companies(ticker);

CREATE TABLE IF NOT EXISTS filings (
    id           TEXT PRIMARY KEY,
    company_id   TEXT REFERENCES companies(id),
    filer_name   TEXT,
    filing_type  TEXT,
    period_end   TEXT,
    source       TEXT,
    source_id    TEXT,
    source_url   TEXT,
    indexed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_filing_co ON filings(company_id);

CREATE TABLE IF NOT EXISTS mentions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    filing_id      TEXT REFERENCES filings(id),
    mentioned_name TEXT NOT NULL,
    company_id     TEXT,
    mention_type   TEXT,
    context        TEXT,
    section_path   TEXT,
    match_type     TEXT DEFAULT 'full_name',
    confidence     REAL DEFAULT 1.0,
    created_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_mention_co   ON mentions(company_id);
CREATE INDEX IF NOT EXISTS idx_mention_name ON mentions(mentioned_name);
CREATE INDEX IF NOT EXISTS idx_mention_type ON mentions(mention_type);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    filing_id  UNINDEXED,
    company_id UNINDEXED,
    section_path UNINDEXED,
    content,
    tokenize = 'trigram'
);
"""


class DataSourceDB:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._conn()) as conn:
            conn.executescript(_SCHEMA)
            conn.commit()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), timeout=10, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    # ── Companies ─────────────────────────────────────────────────────────────

    def upsert_company(self, company: CompanyRecord) -> str:
        sql = """INSERT INTO companies VALUES (?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET
                   aliases=excluded.aliases, sources=excluded.sources,
                   ticker=COALESCE(excluded.ticker, ticker),
                   is_listed=MAX(excluded.is_listed, is_listed)"""
        with closing(self._conn()) as conn:
            conn.execute(sql, (
                company.id, company.name, company.name_en,
                company.ticker, company.exchange,
                int(company.is_listed), company.country,
                json.dumps(company.aliases, ensure_ascii=False),
                json.dumps(company.sources, ensure_ascii=False),
                company.created_at,
            ))
            conn.commit()
        return company.id

    def find_company(self, name_or_ticker: str) -> CompanyRecord | None:
        with closing(self._conn()) as conn:
            row = conn.execute(
                "SELECT * FROM companies WHERE LOWER(ticker)=?",
                (name_or_ticker.lower(),),
            ).fetchone()
            if not row:
                row = conn.execute(
                    "SELECT * FROM companies WHERE id=?",
                    (normalize(name_or_ticker),),
                ).fetchone()
        return _co_from_row(row) if row else None

    # ── Filings ───────────────────────────────────────────────────────────────

    def upsert_filing(self, filing: FilingRecord):
        with closing(self._conn()) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO filings VALUES (?,?,?,?,?,?,?,?,?)",
                (filing.id, filing.company_id, filing.filer_name,
                 filing.filing_type, filing.period_end, filing.source,
                 filing.source_id, filing.source_url, filing.indexed_at),
            )
            conn.commit()

    def get_filings(self, company_id: str) -> list[FilingRecord]:
        with closing(self._conn()) as conn:
            rows = conn.execute(
                "SELECT * FROM filings WHERE company_id=? ORDER BY period_end DESC",
                (company_id,),
            ).fetchall()
        return [_filing_from_row(r) for r in rows]

    # ── Mentions ──────────────────────────────────────────────────────────────

    def insert_mention(self, mention: MentionRecord):
        with closing(self._conn()) as conn:
            conn.execute(
                """INSERT INTO mentions
                   (filing_id,mentioned_name,company_id,mention_type,context,
                    section_path,match_type,confidence,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (mention.filing_id, mention.mentioned_name, mention.company_id,
                 mention.mention_type, mention.context, mention.section_path,
                 mention.match_type, mention.confidence, mention.created_at),
            )
            conn.commit()

    def get_mentions_of(self, company_name: str,
                        mention_type: str | None = None) -> list[MentionRecord]:
        key = normalize(company_name)
        q = "SELECT * FROM mentions WHERE mentioned_name=? OR company_id=?"
        params: list = [company_name, key]
        if mention_type:
            q += " AND mention_type=?"
            params.append(mention_type)
        with closing(self._conn()) as conn:
            rows = conn.execute(q, params).fetchall()
        return [_mention_from_row(r) for r in rows]

    # ── FTS5 ──────────────────────────────────────────────────────────────────

    def fts_index(self, filing_id: str, company_id: str | None,
                  section_path: str, content: str):
        with closing(self._conn()) as conn:
            conn.execute(
                "INSERT INTO search_fts(filing_id,company_id,section_path,content) "
                "VALUES(?,?,?,?)",
                (filing_id, company_id, section_path, content),
            )
            conn.commit()

    def search(self, keyword: str, limit: int = 20) -> list[SearchResult]:
        sql = """SELECT f.id AS filing_id, f.company_id, f.filer_name,
                        s.section_path,
                        snippet(search_fts, 3, '[', ']', '...', 64) AS snippet
                 FROM search_fts s
                 JOIN filings f ON f.id = s.filing_id
                 WHERE search_fts MATCH ?
                 ORDER BY rank
                 LIMIT ?"""
        with closing(self._conn()) as conn:
            rows = conn.execute(sql, (keyword, limit)).fetchall()
        return [SearchResult(
            filing_id=r["filing_id"], company_id=r["company_id"],
            filer_name=r["filer_name"], section_path=r["section_path"],
            snippet=r["snippet"] or "",
        ) for r in rows]


def _co_from_row(r: sqlite3.Row) -> CompanyRecord:
    return CompanyRecord(
        id=r["id"], name=r["name"], name_en=r["name_en"],
        ticker=r["ticker"], exchange=r["exchange"],
        is_listed=bool(r["is_listed"]), country=r["country"],
        aliases=json.loads(r["aliases"]), sources=json.loads(r["sources"]),
        created_at=r["created_at"],
    )


def _filing_from_row(r: sqlite3.Row) -> FilingRecord:
    return FilingRecord(
        id=r["id"], company_id=r["company_id"], filer_name=r["filer_name"],
        filing_type=r["filing_type"], period_end=r["period_end"],
        source=r["source"], source_id=r["source_id"],
        source_url=r["source_url"], indexed_at=r["indexed_at"],
    )


def _mention_from_row(r: sqlite3.Row) -> MentionRecord:
    return MentionRecord(
        filing_id=r["filing_id"], mentioned_name=r["mentioned_name"],
        company_id=r["company_id"], mention_type=r["mention_type"],
        context=r["context"] or "", section_path=r["section_path"] or "",
        match_type=r["match_type"] or "full_name", confidence=r["confidence"],
    )
```

- [ ] **Step 4: Run tests**

```
.venv\Scripts\python.exe -m pytest tests/test_datasource_db.py -v
```
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/datasource/store/datasource_db.py tests/test_datasource_db.py
git commit -m "feat: DataSourceDB companies + mentions (match_type) + FTS5 trigram"
```

---

## Task 4: PDF extractor

**Files:**
- Create: `src/industry_analysis/datasource/extractor/__init__.py` (empty)
- Create: `src/industry_analysis/datasource/extractor/pdf.py`
- Create: `tests/test_pdf_extractor.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_pdf_extractor.py
from industry_analysis.datasource.extractor.pdf import extract_text_from_pdf, ExtractionResult


def test_empty_bytes_returns_failed():
    r = extract_text_from_pdf(b"")
    assert r.text == ""
    assert r.status == "failed_corrupt"


def test_non_pdf_returns_failed():
    r = extract_text_from_pdf(b"not a pdf at all")
    assert r.status == "failed_corrupt"
    assert r.text == ""


def test_returns_extraction_result():
    # Any valid PDF (even if text-less) must return an ExtractionResult
    r = extract_text_from_pdf(b"%PDF-1.4 minimal")
    assert hasattr(r, "text")
    assert hasattr(r, "status")
    assert r.status in ("success", "failed_corrupt", "failed_ocr")
```

- [ ] **Step 2: Run to confirm failure**

```
.venv\Scripts\python.exe -m pytest tests/test_pdf_extractor.py -v
```

- [ ] **Step 3: Create `src/industry_analysis/datasource/extractor/pdf.py`**

```python
from dataclasses import dataclass
from io import BytesIO


@dataclass
class ExtractionResult:
    text: str
    status: str   # success / failed_corrupt / failed_ocr
    char_count: int = 0

    def __post_init__(self):
        if not self.char_count:
            self.char_count = len(self.text)


def extract_text_from_pdf(data: bytes) -> ExtractionResult:
    """Extract plain text from PDF bytes.

    Returns ExtractionResult with status so callers can distinguish
    'no text found' (failed_ocr — scanned PDF) from 'bad file' (failed_corrupt).
    """
    if not data or not data.strip().startswith(b"%PDF"):
        return ExtractionResult(text="", status="failed_corrupt")
    try:
        from pdfminer.high_level import extract_text
        text = extract_text(BytesIO(data)) or ""
        text = text.strip()
        if not text:
            # File parsed OK but no text layer → likely scanned
            return ExtractionResult(text="", status="failed_ocr")
        return ExtractionResult(text=text, status="success")
    except Exception:
        return ExtractionResult(text="", status="failed_corrupt")
```

- [ ] **Step 4: Run tests**

```
.venv\Scripts\python.exe -m pytest tests/test_pdf_extractor.py -v
```
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/datasource/extractor/ tests/test_pdf_extractor.py
git commit -m "feat: PDF extractor with ExtractionResult status (success/failed_corrupt/failed_ocr)"
```

---

## Task 5: CN sections parser

**Files:**
- Create: `src/industry_analysis/datasource/extractor/sections.py`
- Create: `tests/test_sections_parser.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_sections_parser.py
from industry_analysis.datasource.extractor.sections import parse_sections_cn

CN_TEXT = """第三节 公司业务

一、主营业务

公司主要从事半导体芯片设计，产品包括功率管理芯片。

（一）主要供应商

前五大供应商如下：
1. 台积电（TSMC）：晶圆代工，占采购金额30%
2. 某未上市材料有限公司：占采购金额15%

二、主要客户

公司前三大客户为AI服务器厂商。
"""


def test_returns_non_empty(tmp_path):
    secs = parse_sections_cn(CN_TEXT, document_id="d", symbol="688036.SH")
    assert len(secs) > 0


def test_all_fields_set(tmp_path):
    secs = parse_sections_cn(CN_TEXT, document_id="d", symbol="688036.SH")
    for s in secs:
        assert s.document_id == "d"
        assert s.symbol == "688036.SH"
        assert len(s.content) > 0


def test_detects_supplier_section():
    secs = parse_sections_cn(CN_TEXT, document_id="d", symbol="s")
    headings = [s.heading_path for s in secs]
    assert any("供应商" in h for h in headings)


def test_detects_customer_section():
    secs = parse_sections_cn(CN_TEXT, document_id="d", symbol="s")
    headings = [s.heading_path for s in secs]
    assert any("客户" in h for h in headings)


def test_section_seq_increments():
    secs = parse_sections_cn(CN_TEXT, document_id="d", symbol="s")
    seqs = [s.section_seq for s in secs]
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == len(seqs)
```

- [ ] **Step 2: Run to confirm failure**

```
.venv\Scripts\python.exe -m pytest tests/test_sections_parser.py -v
```

- [ ] **Step 3: Create `src/industry_analysis/datasource/extractor/sections.py`**

```python
import re
from ..models import SectionRecord

# CN heading patterns by level
_CN_H1 = re.compile(r'^第[一二三四五六七八九十百]+[节章]\s*(.{1,30})', re.MULTILINE)
_CN_H2 = re.compile(r'^[一二三四五六七八九十]+[、．.]\s*(.{1,30})', re.MULTILINE)
_CN_H3 = re.compile(r'^（[一二三四五六七八九十]+）\s*(.{1,30})', re.MULTILINE)


def parse_sections_cn(text: str, document_id: str, symbol: str) -> list[SectionRecord]:
    """Split CN annual report / prospectus text into sections by heading patterns."""
    boundaries: list[tuple[int, int, str]] = []
    for m in _CN_H1.finditer(text):
        boundaries.append((m.start(), 1, m.group(0).strip()))
    for m in _CN_H2.finditer(text):
        boundaries.append((m.start(), 2, m.group(0).strip()))
    for m in _CN_H3.finditer(text):
        boundaries.append((m.start(), 3, m.group(0).strip()))
    boundaries.sort(key=lambda x: x[0])

    if not boundaries:
        return [SectionRecord(
            document_id=document_id, symbol=symbol,
            section_seq=0, section_level=1,
            heading_path="(全文)", section_name="(全文)",
            content=text.strip(),
        )]

    sections: list[SectionRecord] = []
    path_stack: list[str] = []

    for i, (pos, level, name) in enumerate(boundaries):
        end = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(text)
        content = text[pos:end].strip()
        while len(path_stack) >= level:
            path_stack.pop()
        path_stack.append(name)
        sections.append(SectionRecord(
            document_id=document_id, symbol=symbol,
            section_seq=i, section_level=level,
            heading_path="/".join(path_stack), section_name=name,
            content=content,
        ))
    return sections
```

- [ ] **Step 4: Run tests**

```
.venv\Scripts\python.exe -m pytest tests/test_sections_parser.py -v
```
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/datasource/extractor/sections.py tests/test_sections_parser.py
git commit -m "feat: CN sections parser (年报/招股书 heading patterns)"
```

---

## Task 6: Mentions extractor

**Files:**
- Create: `src/industry_analysis/datasource/extractor/mentions.py`
- Create: `tests/test_mentions_extractor.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_mentions_extractor.py
from industry_analysis.datasource.extractor.mentions import extract_mentions
from industry_analysis.datasource.models import SectionRecord


def _sec(heading: str, content: str, symbol="688036.SH") -> SectionRecord:
    return SectionRecord(document_id="d", symbol=symbol, section_seq=0,
                         section_level=2, heading_path=heading,
                         section_name=heading, content=content)


def test_supplier_full_name():
    sec = _sec("第三节/主要供应商",
               "前五大供应商：台积电（TSMC）占30%，某未上市材料有限公司占15%")
    candidates = extract_mentions([sec])
    assert any(c.mention_type == "supplier" for c in candidates)
    assert any("有限公司" in c.mentioned_name for c in candidates)


def test_match_type_full_name():
    sec = _sec("第三节/主要供应商", "供应商包括绿的谐波技术有限公司，占采购金额20%")
    candidates = extract_mentions([sec])
    assert any(c.match_type == "full_name" for c in candidates)


def test_customer_section():
    sec = _sec("第三节/主要客户",
               "主要客户：华为技术有限公司（20%），中兴通讯股份有限公司（15%）")
    candidates = extract_mentions([sec])
    assert all(c.mention_type == "customer" for c in candidates)
    assert len(candidates) >= 1


def test_context_included():
    sec = _sec("第三节/主要供应商",
               "主要供应商为绿的谐波技术有限公司，供应谐波减速器，占采购金额25%")
    candidates = extract_mentions([sec])
    assert any("谐波" in c.context for c in candidates)


def test_irrelevant_section_empty():
    sec = _sec("第一节/重要提示", "本报告不构成投资建议，请谨慎阅读。")
    assert extract_mentions([sec]) == []
```

- [ ] **Step 2: Run to confirm failure**

```
.venv\Scripts\python.exe -m pytest tests/test_mentions_extractor.py -v
```

- [ ] **Step 3: Create `src/industry_analysis/datasource/extractor/mentions.py`**

```python
import re
from ..models import MentionCandidate, SectionRecord

_SUPPLIER_KW = ["供应商", "采购", "Supply Chain", "Supplier", "Suppliers", "Vendor"]
_CUSTOMER_KW = ["客户", "销售", "Customer", "Customers", "Client"]
_COMPETITOR_KW = ["竞争", "同行", "Competition", "Competitor"]

# Full legal name patterns — high confidence, match_type=full_name
_CN_FULL = re.compile(
    r'[一-鿿]{2,20}'
    r'(?:有限公司|股份有限公司|有限责任公司|集团有限公司|科技有限公司|'
    r'技术有限公司|材料有限公司|电子有限公司|半导体有限公司|集团股份有限公司)'
)
_EN_FULL = re.compile(
    r'\b[A-Z][A-Za-z\s\-&,\.]{2,40}'
    r'(?:Inc\.|Corp\.|LLC|Ltd\.|Co\.,?\s*Ltd|Corporation|Company|'
    r'Technologies|Systems|Semiconductor|Technology|Holdings|Group)\b'
)
# Short well-known names — medium confidence, match_type=short_name
_EN_KNOWN = re.compile(
    r'\b(?:TSMC|ASML|NVIDIA|AMD|Intel|Samsung|Micron|Broadcom|Marvell|'
    r'Qualcomm|Applied Materials|Lam Research)\b'
)

_CONTEXT_WINDOW = 200


def _classify(heading_path: str) -> str | None:
    hp = heading_path.lower()
    if any(k.lower() in hp for k in _SUPPLIER_KW):
        return "supplier"
    if any(k.lower() in hp for k in _CUSTOMER_KW):
        return "customer"
    if any(k.lower() in hp for k in _COMPETITOR_KW):
        return "competitor"
    return None


def extract_mentions(sections: list[SectionRecord]) -> list[MentionCandidate]:
    """Extract company mentions from relevant (supplier/customer/competitor) sections.

    Returns MentionCandidate list. These are CANDIDATES — not verified facts.
    match_type distinguishes full legal names (higher confidence) from short names.
    """
    results: list[MentionCandidate] = []
    for sec in sections:
        mention_type = _classify(sec.heading_path)
        if mention_type is None:
            continue
        text = sec.content
        seen: set[str] = set()
        # Full names first (higher confidence)
        for pat, mtype in ((_CN_FULL, "full_name"), (_EN_FULL, "full_name"),
                           (_EN_KNOWN, "short_name")):
            for m in pat.finditer(text):
                name = m.group(0).strip()
                if name in seen or len(name) < 2:
                    continue
                seen.add(name)
                cs = max(0, m.start() - _CONTEXT_WINDOW // 2)
                ce = min(len(text), m.end() + _CONTEXT_WINDOW // 2)
                results.append(MentionCandidate(
                    mentioned_name=name, mention_type=mention_type,
                    context=text[cs:ce].strip(),
                    section_path=sec.heading_path,
                    match_type=mtype,
                    confidence=0.9 if mtype == "full_name" else 0.6,
                ))
    return results
```

- [ ] **Step 4: Run tests**

```
.venv\Scripts\python.exe -m pytest tests/test_mentions_extractor.py -v
```
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/industry_analysis/datasource/extractor/mentions.py tests/test_mentions_extractor.py
git commit -m "feat: mentions extractor with match_type (full_name/short_name)"
```

---

## Task 7: Cninfo connector

**Files:**
- Create: `src/industry_analysis/datasource/connectors/__init__.py` (empty)
- Create: `src/industry_analysis/datasource/connectors/base.py`
- Create: `src/industry_analysis/datasource/connectors/cninfo.py`
- Create: `tests/test_cninfo_connector.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_cninfo_connector.py
from unittest.mock import MagicMock, patch
from industry_analysis.datasource.connectors.cninfo import CninfoConnector

_RESPONSE = {
    "announcements": [{
        "announcementId": "1234567890",
        "announcementTitle": "贵州茅台：2025年年度报告",
        "announcementTime": 1743984000000,
        "adjunctUrl": "finalpage/2026-04-07/1234567890.PDF",
    }],
    "hasMore": False,
}


def _mock_post(url, **kwargs):
    r = MagicMock()
    r.raise_for_status = MagicMock()
    r.json.return_value = _RESPONSE
    return r


def test_list_filings_returns_documents():
    c = CninfoConnector(rate_limit=0)
    with patch("httpx.post", side_effect=_mock_post):
        docs = c.list_filings("600519.SH", doc_types=["annual"])
    assert len(docs) == 1
    assert docs[0].symbol == "600519.SH"
    assert docs[0].doc_type == "annual"
    assert docs[0].download_status == "pending"
    assert "1234567890" in (docs[0].source_url or "")


def test_list_filings_empty():
    c = CninfoConnector(rate_limit=0)
    r = MagicMock()
    r.raise_for_status = MagicMock()
    r.json.return_value = {"announcements": [], "hasMore": False}
    with patch("httpx.post", return_value=r):
        assert c.list_filings("999999.SZ", doc_types=["annual"]) == []


def test_download_returns_bytes():
    c = CninfoConnector(rate_limit=0)
    r = MagicMock()
    r.raise_for_status = MagicMock()
    r.content = b"%PDF-fake"
    with patch("httpx.get", return_value=r):
        assert c.download_pdf("http://example.com/a.PDF") == b"%PDF-fake"
```

- [ ] **Step 2: Run to confirm failure**

```
.venv\Scripts\python.exe -m pytest tests/test_cninfo_connector.py -v
```

- [ ] **Step 3: Create `src/industry_analysis/datasource/connectors/base.py`**

```python
from abc import ABC, abstractmethod
from ..models import DocumentRecord


class BaseConnector(ABC):
    @abstractmethod
    def list_filings(self, symbol: str, doc_types: list[str]) -> list[DocumentRecord]:
        """Return document metadata without downloading content."""

    @abstractmethod
    def download_pdf(self, url: str) -> bytes:
        """Download filing content as raw bytes."""
```

- [ ] **Step 4: Create `src/industry_analysis/datasource/connectors/cninfo.py`**

```python
import time
import httpx
from datetime import datetime, timezone

from .base import BaseConnector
from ..models import DocumentRecord

_QUERY_URL = "http://www.cninfo.com.cn/new/hisAnnouncement/query"
_PDF_BASE   = "http://static.cninfo.com.cn/"
_TIMEOUT    = 30.0

_CATEGORY_MAP = {
    "annual":     "category_ndbg_szsh",
    "h1":         "category_bndbg_szsh",
    "q1":         "category_yjdbg_szsh",
    "q3":         "category_sjdbg_szsh",
    "prospectus": "category_zqbg_szsh",
}


def _parse_doc_type(title: str) -> str:
    if "年度报告" in title:      return "annual"
    if "半年度报告" in title or "中期报告" in title: return "h1"
    if "一季度" in title:        return "q1"
    if "三季度" in title:        return "q3"
    if "招股说明书" in title or "招股书" in title: return "prospectus"
    return "other"


class CninfoConnector(BaseConnector):
    def __init__(self, rate_limit: float = 1.0):
        self._rate_limit = rate_limit
        self._last: float = 0.0

    def _wait(self):
        elapsed = time.monotonic() - self._last
        if elapsed < self._rate_limit:
            time.sleep(self._rate_limit - elapsed)
        self._last = time.monotonic()

    def list_filings(self, symbol: str, doc_types: list[str]) -> list[DocumentRecord]:
        code = symbol.split(".")[0]
        market = "sh" if symbol.endswith(".SH") else "sz"
        categories = ",".join(_CATEGORY_MAP[t] for t in doc_types if t in _CATEGORY_MAP)
        self._wait()
        resp = httpx.post(
            _QUERY_URL,
            data={"stock": f"{code},{market.upper()}", "category": categories,
                  "pageNum": 1, "pageSize": 30, "column": market,
                  "tabName": "fulltext", "isHLtitle": True},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        docs: list[DocumentRecord] = []
        for ann in resp.json().get("announcements") or []:
            title = ann.get("announcementTitle", "")
            doc_type = _parse_doc_type(title)
            if doc_type not in doc_types:
                continue
            ts_ms = ann.get("announcementTime", 0)
            pub = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
            adjunct = ann.get("adjunctUrl", "")
            cninfo_id = ann.get("announcementId", "")
            docs.append(DocumentRecord(
                id=f"{symbol}_{doc_type}_{pub}_{cninfo_id}",
                symbol=symbol, doc_type=doc_type,
                publish_date=pub, title=title,
                source_url=_PDF_BASE + adjunct if adjunct else None,
            ))
        return docs

    def download_pdf(self, url: str) -> bytes:
        self._wait()
        resp = httpx.get(url, timeout=_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()
        return resp.content
```

- [ ] **Step 5: Run tests**

```
.venv\Scripts\python.exe -m pytest tests/test_cninfo_connector.py -v
```
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add src/industry_analysis/datasource/connectors/ tests/test_cninfo_connector.py
git commit -m "feat: cninfo connector (list annual/prospectus + download)"
```

---

## Task 8: EdgarTools connector (US filings via edgartools)

**Files:**
- Create: `src/industry_analysis/datasource/connectors/edgartools_conn.py`
- Create: `tests/test_edgartools_connector.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_edgartools_connector.py
from unittest.mock import MagicMock, patch, PropertyMock
from industry_analysis.datasource.connectors.edgartools_conn import EdgarToolsConnector

# Minimal filing mock matching edgartools Filing interface
def _mock_filing(accession="0001045810-26-000028", form="10-K",
                 period="2026-01-26", date="2026-02-26"):
    f = MagicMock()
    f.accession_no = accession
    f.form = form
    f.period_of_report = period
    f.filing_date = date
    f.filing_url = f"https://www.sec.gov/Archives/edgar/data/1045810/000104581026000028/nvda-20260126.htm"
    return f


def _mock_company(filings_list):
    company = MagicMock()
    filings_obj = MagicMock()
    filings_obj.__iter__ = MagicMock(return_value=iter(filings_list))
    filings_obj.latest = MagicMock(return_value=filings_list)
    company.get_filings = MagicMock(return_value=filings_obj)
    return company


def test_list_filings_10k():
    conn = EdgarToolsConnector(user_agent="Test/1.0 test@test.com")
    mock_co = _mock_company([_mock_filing()])
    with patch("industry_analysis.datasource.connectors.edgartools_conn.Company",
               return_value=mock_co):
        docs = conn.list_filings("NVDA", doc_types=["10-K"])
    assert len(docs) >= 1
    assert docs[0].symbol == "NVDA"
    assert docs[0].doc_type == "10-K"
    assert docs[0].download_status == "pending"


def test_list_s1():
    conn = EdgarToolsConnector(user_agent="Test/1.0 test@test.com")
    mock_co = _mock_company([_mock_filing(form="S-1", period="2024-06-15")])
    with patch("industry_analysis.datasource.connectors.edgartools_conn.Company",
               return_value=mock_co):
        docs = conn.list_filings("RDDT", doc_types=["S-1"])
    assert len(docs) >= 1
    assert docs[0].doc_type == "S-1"


def test_get_sections_returns_section_records():
    conn = EdgarToolsConnector(user_agent="Test/1.0 test@test.com")
    # Mock a 10-K object with items
    item1 = MagicMock()
    item1.name = "Item 1. Business"
    item1.text = "We design and market AI semiconductors for data center applications."
    tenk = MagicMock()
    tenk.items = [item1]
    mock_filing = _mock_filing()
    mock_filing.obj = MagicMock(return_value=tenk)
    mock_co = _mock_company([mock_filing])
    with patch("industry_analysis.datasource.connectors.edgartools_conn.Company",
               return_value=mock_co):
        sections = conn.get_sections("NVDA", "0001045810-26-000028", "10-K")
    assert len(sections) >= 1
    assert sections[0].section_name == "Item 1. Business"
    assert "semiconductors" in sections[0].content
```

- [ ] **Step 2: Run to confirm failure**

```
.venv\Scripts\python.exe -m pytest tests/test_edgartools_connector.py -v
```

- [ ] **Step 3: Create `src/industry_analysis/datasource/connectors/edgartools_conn.py`**

```python
"""US filing connector using edgartools (github.com/dgunning/edgartools, MIT).

edgartools fetches EDGAR HTML filings directly — no PDF pipeline needed for US.
It provides section extraction for 10-K items (Business, Risk Factors, MD&A, etc.)
and S-1 sections out of the box.
"""
import time

from .base import BaseConnector
from ..models import DocumentRecord, SectionRecord

try:
    from edgar import Company, set_identity
except ImportError as e:
    raise ImportError("edgartools not installed. Run: pip install edgartools>=5.0") from e

_FORM_TO_DOC_TYPE = {"10-K": "10-K", "10-K/A": "10-K", "S-1": "S-1", "S-1/A": "S-1"}

# Sections we care about for supply-chain mining
_PRIORITY_ITEMS = {
    "Item 1",        # Business
    "Item 1A",       # Risk Factors
    "Item 7",        # MD&A
    "Business",      # S-1 equivalent
    "Customers",
    "Supply Chain",
    "Suppliers",
    "Competition",
}


class EdgarToolsConnector(BaseConnector):
    def __init__(self, user_agent: str = "IndustryAnalysis/1.0 contact@example.com",
                 rate_limit: float = 0.12):
        set_identity(user_agent)
        self._rate_limit = rate_limit
        self._last: float = 0.0

    def _wait(self):
        elapsed = time.monotonic() - self._last
        if elapsed < self._rate_limit:
            time.sleep(self._rate_limit - elapsed)
        self._last = time.monotonic()

    def list_filings(self, symbol: str,
                     doc_types: list[str] | None = None) -> list[DocumentRecord]:
        """List recent filings for a US ticker. doc_types accepts '10-K', 'S-1'."""
        target_forms = doc_types or ["10-K", "S-1"]
        docs: list[DocumentRecord] = []
        self._wait()
        company = Company(symbol)
        for form in target_forms:
            try:
                filings = company.get_filings(form=form).latest(5)
                for f in filings:
                    doc_type = _FORM_TO_DOC_TYPE.get(f.form, f.form)
                    period = str(f.period_of_report) if f.period_of_report else None
                    pub = str(f.filing_date) if f.filing_date else None
                    doc_id = f"{symbol}_{doc_type}_{period}_{f.accession_no}"
                    docs.append(DocumentRecord(
                        id=doc_id, symbol=symbol, doc_type=doc_type,
                        period_end=period, publish_date=pub,
                        title=f"{symbol} {f.form} {period}",
                        source_url=getattr(f, "filing_url", None),
                    ))
                    self._wait()
            except Exception:
                continue
        return docs

    def get_sections(self, symbol: str, accession_no: str,
                     form: str) -> list[SectionRecord]:
        """Extract sections from a filing using edgartools' section detection.

        Returns SectionRecord list — no PDF or custom regex needed for US filings.
        """
        self._wait()
        company = Company(symbol)
        filings = company.get_filings(form=form).latest(10)
        target = next(
            (f for f in filings if f.accession_no == accession_no), None
        )
        if target is None:
            return []
        doc_id = f"{symbol}_{_FORM_TO_DOC_TYPE.get(form, form)}_*_{accession_no}"
        try:
            obj = target.obj()
        except Exception:
            return []

        sections: list[SectionRecord] = []
        items = getattr(obj, "items", None) or []
        for i, item in enumerate(items):
            name = getattr(item, "name", "") or f"Item {i}"
            text = getattr(item, "text", "") or ""
            if not text.strip():
                continue
            sections.append(SectionRecord(
                document_id=doc_id, symbol=symbol,
                section_seq=i, section_level=1,
                heading_path=name, section_name=name,
                content=text.strip(),
            ))
        return sections

    def download_pdf(self, url: str) -> bytes:
        # edgartools uses HTML natively; this is a fallback for rare PDF links
        import httpx
        self._wait()
        r = httpx.get(url, headers={"User-Agent": "IndustryAnalysis/1.0"},
                      timeout=20, follow_redirects=True)
        r.raise_for_status()
        return r.content
```

- [ ] **Step 4: Run tests**

```
.venv\Scripts\python.exe -m pytest tests/test_edgartools_connector.py -v
```
Expected: 3 passed

- [ ] **Step 5: Run full suite**

```
.venv\Scripts\python.exe -m pytest -v
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/industry_analysis/datasource/connectors/edgartools_conn.py tests/test_edgartools_connector.py
git commit -m "feat: EdgarToolsConnector — US 10-K/S-1 via edgartools (no PDF)"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| DataSourceSettings with 3 computed db paths | Task 1 |
| All models incl. 3-status DocumentRecord, match_type MentionCandidate | Task 1 |
| FilingsDB shared schema (documents/sections/announcements) + 3 status fields | Task 2 |
| FilingsDB readonly mode (pointing at existing D:/quantdata CN db) | Task 2 |
| DataSourceDB companies + mentions (match_type) + FTS5 trigram | Task 3 |
| PDF extractor with ExtractionResult (success/failed_corrupt/failed_ocr) | Task 4 |
| CN sections parser | Task 5 |
| Mentions extractor (candidate generator, match_type, confidence) | Task 6 |
| Cninfo connector | Task 7 |
| SEC EDGAR — edgartools wrapper (no custom connector) | Task 8 |
| pdfminer.six + edgartools deps | Task 1 |
| Unlisted companies (no ticker, first-class in companies table) | Task 3 |

**Review changes verified applied:**
- ✅ 3 independent status fields (download/extract/index) — Tasks 1, 2
- ✅ match_type on MentionCandidate/MentionRecord — Tasks 1, 3, 6
- ✅ EdgarToolsConnector replaces raw SEC EDGAR — Task 8
- ✅ ExtractionResult status (failed_corrupt vs failed_ocr) — Task 4

**No placeholders found.** All code blocks are complete and self-contained.
