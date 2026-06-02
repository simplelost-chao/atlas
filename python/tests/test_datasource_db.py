import pytest
from industry_analysis.datasource.store.datasource_db import DataSourceDB
from industry_analysis.datasource.models import CompanyRecord, FilingRecord, MentionRecord


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


def test_fts_supply_chain_keyword(db):
    db.upsert_company(_company())
    db.upsert_filing(_filing())
    db.fts_index("cn:688036.SH_annual_2024-12-31", "圣邦股份",
                 "第三节/供应商",
                 "主要供应商包括绿的谐波技术有限公司，提供谐波减速器零部件")
    assert len(db.search("谐波减速器")) >= 1


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


def test_get_unextracted_docs_filters_already_indexed(db, tmp_path):
    import sqlite3 as _sqlite3
    # Create a minimal CN filings.db with 2 documents
    cn_path = tmp_path / "cn.db"
    cn_conn = _sqlite3.connect(str(cn_path))
    cn_conn.executescript("""
        CREATE TABLE documents (
            id TEXT, symbol TEXT, doc_type TEXT,
            period_end TEXT, content_hash TEXT, parse_status TEXT
        );
        INSERT INTO documents VALUES ('d1','SYM.SZ','annual','2025-12-31','h1','success');
        INSERT INTO documents VALUES ('d2','SYM.SZ','annual','2024-12-31','h2','success');
    """)
    cn_conn.commit()

    # Initially both are unextracted
    unextracted = db.get_unextracted_docs(cn_conn, "v1")
    assert len(unextracted) == 2

    # Mark d1 as extracted
    db.mark_extracted("d1", "h1", "v1")

    # Only d2 should remain
    unextracted2 = db.get_unextracted_docs(cn_conn, "v1")
    assert len(unextracted2) == 1
    assert unextracted2[0]["id"] == "d2"

    cn_conn.close()
