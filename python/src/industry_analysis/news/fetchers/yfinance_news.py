"""yfinance ticker news fetcher — free, no API key.

Fetches recent news for specific tickers from Yahoo Finance.
Useful for supply-chain companies in our universe (NVDA, TSLA, etc.).
"""
from __future__ import annotations

import time
from ..models import NewsArticle

# Core supply-chain ticker universe (ARK themes)
DEFAULT_TICKERS = [
    "NVDA", "AVGO", "TSM", "AMAT", "ASML", "LRCX", "KLAC",   # AI semicon
    "TSLA", "ISRG", "ABB", "ROK",                              # robotics
    "RKLB", "ASTS", "LMT", "RTX",                              # space
    "ALB", "MU", "ENPH",                                       # new energy / memory
]


def fetch(
    tickers: list[str] | None = None,
    max_per_ticker: int = 5,
    rate_limit: float = 0.3,
) -> list[NewsArticle]:
    """Fetch recent news for supply-chain tickers via yfinance."""
    try:
        import yfinance as yf
    except ImportError:
        return []

    target = tickers or DEFAULT_TICKERS
    articles: list[NewsArticle] = []
    seen: set[str] = set()

    for ticker in target:
        try:
            time.sleep(rate_limit)
            t = yf.Ticker(ticker)
            news_items = t.news or []
            for item in news_items[:max_per_ticker]:
                # yfinance v0.2+ new structure: item = {id, content: {title, description, pubDate, provider, canonicalUrl}}
                content = item.get("content") or item
                title = content.get("title", "") or item.get("title", "")
                if not title:
                    continue
                url = (content.get("canonicalUrl") or {}).get("url", "") or \
                      content.get("clickThroughUrl", {}).get("url", "") or \
                      item.get("link", "")
                if url in seen:
                    continue
                seen.add(url)
                provider = (content.get("provider") or {}).get("displayName", "Yahoo Finance")
                pub = content.get("pubDate", "") or str(item.get("providerPublishTime", ""))
                body = content.get("summary", "") or content.get("description", "") or title
                # Strip HTML tags from description
                import re
                body = re.sub(r"<[^>]+>", "", body)
                articles.append(NewsArticle(
                    title=title,
                    content=body[:500],
                    source=provider,
                    published_at=pub,
                    url=url,
                    language="en",
                    tags=[ticker],
                ))
        except Exception:
            continue

    return articles
