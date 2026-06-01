from dataclasses import dataclass, field
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class DocumentRecord:
    id: str
    symbol: str
    doc_type: str                     # annual/prospectus/10-K/S-1/q1/h1
    period_end: str | None = None
    report_period: str | None = None
    publish_date: str | None = None
    title: str | None = None
    source_url: str | None = None
    local_path: str | None = None
    download_status: str = "pending"  # pending/success/failed
    extract_status: str = "pending"   # pending/success/failed_corrupt/failed_ocr
    index_status: str = "pending"     # pending/success/failed
    downloaded_at: str | None = None
    extracted_at: str | None = None
    indexed_at: str | None = None
    updated_at: str = field(default_factory=_now)


@dataclass
class SectionRecord:
    document_id: str
    symbol: str
    section_seq: int
    section_level: int
    heading_path: str
    section_name: str
    content: str
    char_count: int = 0

    def __post_init__(self):
        if not self.char_count:
            self.char_count = len(self.content)


@dataclass
class CompanyRecord:
    id: str
    name: str
    name_en: str | None = None
    ticker: str | None = None
    exchange: str | None = None
    is_listed: bool = False
    country: str = "CN"
    aliases: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now)


@dataclass
class FilingRecord:
    id: str
    company_id: str | None
    filer_name: str | None
    filing_type: str
    period_end: str | None
    source: str                       # cn_filings / us_filings
    source_id: str
    source_url: str | None = None
    indexed_at: str = field(default_factory=_now)


@dataclass
class MentionCandidate:
    """Raw extraction result — candidate, not verified fact."""
    mentioned_name: str
    mention_type: str                 # supplier/customer/competitor/investee/other
    context: str
    section_path: str
    confidence: float = 1.0
    match_type: str = "full_name"     # full_name / short_name / context


@dataclass
class MentionRecord:
    filing_id: str
    mentioned_name: str
    company_id: str | None
    mention_type: str
    context: str
    section_path: str
    match_type: str = "full_name"
    confidence: float = 1.0
    created_at: str = field(default_factory=_now)


@dataclass
class SearchResult:
    filing_id: str
    company_id: str | None
    filer_name: str | None
    section_path: str
    snippet: str


@dataclass
class CompanyProfile:
    company: CompanyRecord
    filings: list[FilingRecord]
    mention_counts: dict[str, int]
