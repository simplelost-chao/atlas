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
