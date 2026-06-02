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

        sections = cn_conn.execute(
            f"SELECT * FROM sections WHERE document_id=? AND ({_HEADING_SQL})"
            " ORDER BY section_seq",
            (doc_id,),
        ).fetchall()

        if not sections:
            self.ds.mark_extracted(doc_id, content_hash, self.version, 0)
            result.docs_processed += 1
            return result

        filing_id = f"cn:{doc_id}"
        self.ds.upsert_filing(FilingRecord(
            id=filing_id,
            company_id=doc["symbol"],
            filer_name=doc["symbol"],
            filing_type=doc["doc_type"],
            period_end=doc["period_end"],
            source="cn_filings",
            source_id=doc_id,
        ))

        indexed = 0
        section_seqs = {s["section_seq"] for s in sections}
        for sec in sections:
            snippet = self._build_snippet(cn_conn, doc_id, sec["section_seq"])
            self.ds.fts_index(filing_id, doc["symbol"],
                              sec["heading_path"], snippet)
            indexed += 1

        self.ds.mark_extracted(doc_id, content_hash, self.version, indexed)
        result.docs_processed += 1
        result.sections_indexed += indexed
        return result

    def _build_snippet(self, cn_conn: sqlite3.Connection, document_id: str,
                       seq: int) -> str:
        """Return matched section content + adjacent context (±1 section)."""
        rows = cn_conn.execute(
            """SELECT content FROM sections
               WHERE document_id=? AND section_seq BETWEEN ? AND ?
               ORDER BY section_seq""",
            (document_id, seq - 1, seq + 1),
        ).fetchall()
        parts = [r["content"][:400] for r in rows]
        return "\n".join(parts)[:1200]
