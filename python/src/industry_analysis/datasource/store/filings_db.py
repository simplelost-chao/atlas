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
