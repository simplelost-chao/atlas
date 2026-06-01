"""US filing connector using edgartools (github.com/dgunning/edgartools, MIT, v5+).

edgartools fetches EDGAR HTML filings directly — no PDF pipeline needed for US.
Provides section extraction for 10-K items (Business, Risk Factors, MD&A, etc.)
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
        """List recent filings for a US ticker. doc_types: ['10-K', 'S-1']."""
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

        No PDF needed — edgartools parses EDGAR HTML directly.
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
        """Fallback for any PDF links; edgartools uses HTML natively."""
        import httpx
        self._wait()
        r = httpx.get(url, headers={"User-Agent": "IndustryAnalysis/1.0"},
                      timeout=20, follow_redirects=True)
        r.raise_for_status()
        return r.content
