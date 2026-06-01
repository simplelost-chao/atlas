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
