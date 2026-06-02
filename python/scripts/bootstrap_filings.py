"""
Bootstrap filing data for supply-chain mining.

Does three things:
  1. Index CN filings (from existing D:/quantdata/markets/CN/filings.db)
     – reads supplier/customer/competitor sections → FTS5 + mentions
  2. Fetch US filings for key supply-chain tickers via edgartools
     – 10-K (last 2 years) + S-1 for recent IPOs
  3. Index US sections → FTS5 + mentions

Run: python scripts/bootstrap_filings.py [--cn-only] [--us-only] [--dry-run]

Key tickers (from supply-chain research — Serenity framework):
  AI Infrastructure: NVDA AVGO TSM COHR AAOI AXTI ONTO ALAB ANET MRVL
  Robotics:          TER SYM ISRG
  Energy/Power:      VRT ETN MOD
  Space:             RKLB
"""
import argparse
import sys
import os
from pathlib import Path
from datetime import datetime, timezone

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

# ── Supply-chain target universe ─────────────────────────────────────────────

CN_FILING_KEYWORDS = {
    "supplier": ["主要供应商", "采购", "供货商"],
    "customer": ["主要客户", "销售客户"],
    "competitor": ["竞争对手", "同行竞争", "竞争企业"],
    "business":  ["主营业务", "主要产品", "业务概要", "经营情况"],
}

US_TICKERS = [
    # AI semiconductor / optical interconnect
    "NVDA", "AVGO", "TSM",  "COHR", "AAOI", "AXTI", "ONTO", "ALAB",
    "ANET", "MRVL",
    # Robotics
    "TER",  "SYM",  "ISRG",
    # Power / cooling
    "VRT",  "ETN",  "MOD",
    # Space
    "RKLB",
]

CN_SECTION_FILTERS = list({kw for kws in CN_FILING_KEYWORDS.values() for kw in kws})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── CN indexing ───────────────────────────────────────────────────────────────

def index_cn(ds_db, cn_db, dry_run: bool = False):
    """Read supplier/customer sections from CN filings.db → FTS5 + mentions."""
    from industry_analysis.datasource.store.datasource_db import DataSourceDB
    from industry_analysis.datasource.store.filings_db import FilingsDB
    from industry_analysis.datasource.models import CompanyRecord, FilingRecord, MentionRecord
    from industry_analysis.datasource.extractor.mentions import extract_mentions
    from industry_analysis.graph.models import normalize

    print("\n[CN] Indexing from existing filings.db ...")
    docs = cn_db.find_documents(doc_type="annual") + cn_db.find_documents(doc_type="prospectus")
    print(f"[CN] Found {len(docs)} annual+prospectus documents to index")

    skipped = indexed = mentions_added = 0
    for doc in docs:
        # Skip already indexed
        company_id = normalize(doc.symbol)
        filing_id = f"cn:{doc.id}"

        sections = cn_db.get_sections(doc.id, heading_filter=CN_SECTION_FILTERS)
        if not sections:
            skipped += 1
            continue

        if dry_run:
            print(f"  [dry] would index {doc.symbol} {doc.doc_type} ({len(sections)} sections)")
            indexed += 1
            continue

        # Upsert company (listed, CN)
        ds_db.upsert_company(CompanyRecord(
            id=company_id, name=doc.symbol, ticker=doc.symbol,
            is_listed=True, country="CN",
        ))

        # Upsert filing pointer
        ds_db.upsert_filing(FilingRecord(
            id=filing_id, company_id=company_id, filer_name=doc.symbol,
            filing_type=doc.doc_type, period_end=doc.period_end,
            source="cn_filings", source_id=doc.id, source_url=doc.source_url,
        ))

        # FTS5 index key sections + extract mentions
        for sec in sections:
            ds_db.fts_index(filing_id, company_id, sec.heading_path, sec.content)
            for cand in extract_mentions([sec]):
                ds_db.insert_mention(MentionRecord(
                    filing_id=filing_id,
                    mentioned_name=cand.mentioned_name,
                    company_id=None,
                    mention_type=cand.mention_type,
                    context=cand.context,
                    section_path=cand.section_path,
                    match_type=cand.match_type,
                    confidence=cand.confidence,
                ))
                mentions_added += 1

        indexed += 1
        if indexed % 500 == 0:
            print(f"  [CN] indexed {indexed}/{len(docs)}, {mentions_added} mentions ...")

    print(f"[CN] Done: indexed={indexed}, skipped={skipped}, mentions={mentions_added}")


# ── US fetching + indexing ────────────────────────────────────────────────────

def fetch_and_index_us(ds_db, us_db, tickers: list[str], dry_run: bool = False):
    """Fetch US 10-K/S-1 via edgartools and index into datasource.db."""
    from industry_analysis.datasource.connectors.edgartools_conn import EdgarToolsConnector
    from industry_analysis.datasource.store.filings_db import FilingsDB
    from industry_analysis.datasource.models import CompanyRecord, FilingRecord, MentionRecord
    from industry_analysis.datasource.extractor.mentions import extract_mentions
    from industry_analysis.graph.models import normalize
    from industry_analysis.datasource.config import get_datasource_settings

    cfg = get_datasource_settings()
    conn = EdgarToolsConnector(user_agent=cfg.sec_user_agent, rate_limit=cfg.sec_rate_limit)

    print(f"\n[US] Fetching filings for {len(tickers)} tickers ...")
    for ticker in tickers:
        print(f"  [{ticker}] fetching 10-K + S-1 ...")
        try:
            docs = conn.list_filings(ticker, doc_types=["10-K", "S-1"])
        except Exception as e:
            print(f"  [{ticker}] ERROR listing: {e}")
            continue

        print(f"  [{ticker}] found {len(docs)} filings")
        if not docs or dry_run:
            if dry_run:
                print(f"  [dry] would fetch {len(docs)} docs for {ticker}")
            continue

        company_id = normalize(ticker)
        ds_db.upsert_company(CompanyRecord(
            id=company_id, name=ticker, ticker=ticker,
            is_listed=True, country="US",
        ))

        for doc in docs[:3]:  # last 3 filings per type max
            # Write to US filings.db
            us_db.upsert_document(doc)

            # Fetch sections via edgartools (HTML, no PDF)
            try:
                accession = doc.id.split("_")[-1]  # last segment of doc.id
                form = doc.doc_type
                sections = conn.get_sections(ticker, accession, form)
            except Exception as e:
                print(f"    [{ticker}] {doc.doc_type} sections error: {e}")
                sections = []

            if not sections:
                us_db.set_extract_status(doc.id, "failed_ocr")
                continue

            us_db.replace_sections(doc.id, sections)
            us_db.set_extract_status(doc.id, "success", _now())

            filing_id = f"us:{doc.id}"
            ds_db.upsert_filing(FilingRecord(
                id=filing_id, company_id=company_id, filer_name=ticker,
                filing_type=doc.doc_type, period_end=doc.period_end,
                source="us_filings", source_id=doc.id, source_url=doc.source_url,
            ))

            # FTS5 + mentions
            relevant = [
                s for s in sections
                if any(kw in (s.heading_path or "").lower()
                       for kw in ["business", "customer", "supplier",
                                  "supply chain", "competition", "item 1"])
            ]
            for sec in relevant:
                ds_db.fts_index(filing_id, company_id, sec.heading_path, sec.content)
                for cand in extract_mentions([sec]):
                    ds_db.insert_mention(MentionRecord(
                        filing_id=filing_id, mentioned_name=cand.mentioned_name,
                        company_id=None, mention_type=cand.mention_type,
                        context=cand.context, section_path=cand.section_path,
                        match_type=cand.match_type, confidence=cand.confidence,
                    ))

            us_db.set_index_status(doc.id, "success", _now())
            print(f"    [{ticker}] {doc.doc_type} {doc.period_end}: {len(sections)} sections, {len(relevant)} relevant")

    print("[US] Done")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Bootstrap supply-chain filing data")
    parser.add_argument("--cn-only",  action="store_true", help="Only index CN filings")
    parser.add_argument("--us-only",  action="store_true", help="Only fetch US filings")
    parser.add_argument("--tickers",  nargs="*", default=US_TICKERS, help="US tickers to fetch")
    parser.add_argument("--dry-run",  action="store_true", help="Print what would be done, no writes")
    args = parser.parse_args()

    from industry_analysis.datasource.config import get_datasource_settings
    from industry_analysis.datasource.store.datasource_db import DataSourceDB
    from industry_analysis.datasource.store.filings_db import FilingsDB

    cfg = get_datasource_settings()
    print(f"Cache dir:     {cfg.cache_dir}")
    print(f"CN filings db: {cfg.cn_filings_db_path}")
    print(f"US filings db: {cfg.us_filings_db_path}")
    print(f"Datasource db: {cfg.datasource_db_path}")

    if not args.dry_run:
        cfg.cache_dir.mkdir(parents=True, exist_ok=True)
        (cfg.cache_dir / "CN").mkdir(exist_ok=True)
        (cfg.cache_dir / "US").mkdir(exist_ok=True)

    # Open datastores
    cn_readonly = cfg.cn_filings_db_path.exists()
    cn_db = FilingsDB(cfg.cn_filings_db_path, readonly=cn_readonly)
    us_db = FilingsDB(cfg.us_filings_db_path) if not args.dry_run else None
    ds_db = DataSourceDB(cfg.datasource_db_path) if not args.dry_run else None

    if cn_readonly:
        print(f"\n[CN] Using existing filings.db (readonly): {cfg.cn_filings_db_path}")
    else:
        print(f"\n[CN] filings.db not found at {cfg.cn_filings_db_path} — run cn_worker first")

    if not args.us_only and cn_readonly:
        index_cn(ds_db, cn_db, dry_run=args.dry_run)

    if not args.cn_only:
        fetch_and_index_us(
            ds_db,
            us_db,
            tickers=args.tickers,
            dry_run=args.dry_run,
        )

    print("\nBootstrap complete")
    if not args.dry_run:
        print("  Run `ia datasource search <keyword>` to query")
        print("  Run `ia datasource mentions <company>` to find supply relationships")


if __name__ == "__main__":
    main()
