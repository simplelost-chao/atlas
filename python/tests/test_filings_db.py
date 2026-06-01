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


def test_find_by_extract_status(db):
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
