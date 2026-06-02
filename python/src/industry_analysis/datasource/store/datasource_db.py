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
        # Wrap in FTS5 phrase quotes so special chars (&, -, +, *) are literals.
        fts_query = '"' + keyword.replace('"', '""') + '"'
        sql = """SELECT f.id AS filing_id, f.company_id, f.filer_name,
                        s.section_path,
                        snippet(search_fts, 3, '[', ']', '...', 64) AS snippet
                 FROM search_fts s
                 JOIN filings f ON f.id = s.filing_id
                 WHERE search_fts MATCH ?
                 ORDER BY rank
                 LIMIT ?"""
        with closing(self._conn()) as conn:
            rows = conn.execute(sql, (fts_query, limit)).fetchall()
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
