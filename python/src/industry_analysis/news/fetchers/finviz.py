"""Finvizfinance US market news fetcher.

Sources:
  - Finviz general news: broad US financial news (Reuters, Bloomberg, etc.)
  - Finviz ticker news: company-specific news by ticker

No API key required. Uses finvizfinance (lit26/finvizfinance on GitHub).
"""
from __future__ import annotations

from ..models import NewsArticle


def fetch_finviz_news(max_articles: int = 50) -> list[NewsArticle]:
    """Fetch general US financial news from Finviz."""
    try:
        from finvizfinance.news import News
        rows = News().get_news().get("news", [])
    except Exception:
        return []

    articles = []
    for row in rows[:max_articles]:
        try:
            title = str(row.get("title", "") or "")
            if not title:
                continue
            articles.append(NewsArticle(
                title=title,
                content="",
                source=str(row.get("source", "finviz") or "finviz"),
                published_at=str(row.get("date", "") or ""),
                url=str(row.get("link", "") or ""),
                language="en",
            ))
        except Exception:
            continue
    return articles


def fetch_finviz_ticker(ticker: str) -> list[NewsArticle]:
    """Fetch news for a specific US ticker from Finviz."""
    try:
        from finvizfinance.quote import finvizfinance
        rows = finvizfinance(ticker).ticker_news()
    except Exception:
        return []

    articles = []
    for row in (rows or []):
        try:
            title = str(row.get("title", "") or "")
            if not title:
                continue
            articles.append(NewsArticle(
                title=title,
                content="",
                source=str(row.get("source", "finviz") or "finviz"),
                published_at=str(row.get("date", "") or ""),
                url=str(row.get("link", "") or ""),
                language="en",
            ))
        except Exception:
            continue
    return articles
