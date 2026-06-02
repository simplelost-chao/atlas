"""Build complete US company registry from SEC EDGAR.

Phase 1 (fast, ~30s): Fetch all exchange-listed companies from
  company_tickers_exchange.json (~6,000-8,000 companies), filter
  obvious funds/ETFs by name, store metadata in datasource.db.

Phase 2 (slow, ~20min, opt-in): Enrich with SIC codes from
  individual submissions JSON, re-filter investment companies.

This script stores METADATA only — no filing text.
Text extraction is lazy: edgartools_conn fetches on first query.

Run:
  python scripts/us_worker.py            # phase 1 only (fast)
  python scripts/us_worker.py --enrich   # phase 1 + SIC enrichment
  python scripts/us_worker.py --dry-run  # preview counts, no writes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


def main():
    parser = argparse.ArgumentParser(description="Build US company registry from SEC EDGAR")
    parser.add_argument("--enrich", action="store_true",
                        help="Fetch SIC codes per company and re-filter (slow, ~20min)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print counts without writing to DB")
    args = parser.parse_args()

    from industry_analysis.datasource.config import get_datasource_settings
    from industry_analysis.datasource.store.datasource_db import DataSourceDB
    from industry_analysis.datasource.connectors.sec_conn import SecConnector, is_fund_by_name
    from industry_analysis.datasource.models import CompanyRecord
    from industry_analysis.graph.models import normalize

    cfg = get_datasource_settings()
    conn = SecConnector(user_agent=cfg.sec_user_agent, rate_limit=0.11)

    # ── Phase 1: fetch exchange-listed companies ───────────────────────────────
    print("Fetching SEC exchange-listed companies ...")
    raw = conn.fetch_listed_companies()
    print(f"  Total from SEC: {len(raw)}")

    # Name-based fund filter (fast, no extra requests)
    operating = [c for c in raw if not is_fund_by_name(c["name"])]
    filtered_by_name = len(raw) - len(operating)
    print(f"  After name filter: {len(operating)} ({filtered_by_name} funds/ETFs removed)")

    if args.dry_run:
        # Show exchange breakdown
        from collections import Counter
        ex_counts = Counter(c["exchange"] for c in operating)
        for ex, cnt in sorted(ex_counts.items(), key=lambda x: -x[1]):
            print(f"    {str(ex):10s}: {cnt}")
        print("Dry run — no writes.")
        return

    if not args.dry_run:
        cfg.cache_dir.mkdir(parents=True, exist_ok=True)

    ds_db = DataSourceDB(cfg.datasource_db_path)

    # ── Phase 2 (optional): enrich SIC + re-filter ────────────────────────────
    if args.enrich:
        print(f"\nEnriching SIC codes for {len(operating)} companies (~{len(operating)//9//60} min) ...")
        enriched = []
        for i, c in enumerate(operating):
            try:
                sub = conn.fetch_submissions(c["cik"])
            except Exception:
                sub = {}
            sic = sub.get("sic")
            category = sub.get("category", "")
            # Drop if SIC or category marks it as investment company
            if conn.is_fund_by_sic(sic) or conn.is_fund_by_category(category):
                continue
            enriched.append({**c, "sic": int(sic) if sic else None})
            if (i + 1) % 500 == 0:
                print(f"  [{i+1}/{len(operating)}] enriched ...")
        print(f"  After SIC filter: {len(enriched)} companies")
        companies_to_store = enriched
    else:
        companies_to_store = [{**c, "sic": None} for c in operating]

    # ── Store in datasource.db ─────────────────────────────────────────────────
    print(f"\nUpserting {len(companies_to_store)} companies into datasource.db ...")
    stored = 0
    for c in companies_to_store:
        cid = normalize(c["ticker"] or c["name"])
        ds_db.upsert_company(CompanyRecord(
            id=cid,
            name=c["name"],
            ticker=c["ticker"] or None,
            exchange=c.get("exchange"),
            is_listed=True,
            country="US",
            cik=str(c["cik"]),
            sic=c.get("sic"),
            sources=["sec_registry"],
        ))
        stored += 1
        if stored % 1000 == 0:
            print(f"  [{stored}/{len(companies_to_store)}] stored ...")

    print(f"\nDone: {stored} US companies in datasource.db")
    print("  Filing text is lazy-loaded — query any ticker to trigger fetch.")


if __name__ == "__main__":
    main()
