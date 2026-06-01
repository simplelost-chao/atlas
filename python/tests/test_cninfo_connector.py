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
