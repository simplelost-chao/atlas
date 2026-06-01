from unittest.mock import MagicMock, patch
from industry_analysis.datasource.connectors.edgartools_conn import EdgarToolsConnector


def _mock_filing(accession="0001045810-26-000028", form="10-K",
                 period="2026-01-26", date="2026-02-26"):
    f = MagicMock()
    f.accession_no = accession
    f.form = form
    f.period_of_report = period
    f.filing_date = date
    f.filing_url = "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000028/nvda-20260126.htm"
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
