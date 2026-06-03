"""GDELT Doc 2.0 real-time news fetcher.

Completely free, no API key. Covers 100+ languages including Chinese,
indexes Reuters, AP, Xinhua, Caixin, Bloomberg (free articles), etc.

API docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
"""
from __future__ import annotations

import time
import httpx

_MAX_RETRIES = 4
from ..models import NewsArticle

_BASE = "https://api.gdeltproject.org/api/v2/doc/doc"

# Supply-chain relevant keyword groups for mining
SUPPLY_CHAIN_QUERIES = {
    "ai_chip": [
        '"semiconductor supply chain" OR "chip shortage" OR "TSMC" OR "NVIDIA" OR "HBM memory"',
        '"人工智能芯片" OR "半导体供应链" OR "芯片短缺" OR "先进封装"',
    ],
    "robotics": [
        '"humanoid robot" OR "robot supply chain" OR "servo motor" OR "harmonic reducer"',
        '"人形机器人" OR "谐波减速器" OR "RV减速器" OR "伺服电机" OR "工业机器人"',
    ],
    "space": [
        '"reusable rocket" OR "SpaceX supply chain" OR "Rocket Lab" OR "satellite manufacturing"',
        '"商业航天" OR "可复用火箭" OR "卫星制造" OR "星链"',
    ],
    "new_energy": [
        '"lithium battery supply chain" OR "solid state battery" OR "rare earth" OR "EV supply"',
        '"锂电池供应链" OR "固态电池" OR "稀土" OR "新能源汽车供应链"',
    ],
}


def fetch(
    query: str,
    timespan: str = "1d",      # e.g. "1d", "12h", "6h"
    max_records: int = 20,
    language: str | None = None,  # None = all, "Chinese" = CN only, "English" = EN only
    rate_limit: float = 1.0,
) -> list[NewsArticle]:
    """Fetch news articles matching query from GDELT.

    Args:
        query: GDELT boolean query string
        timespan: lookback window ("1d", "12h", "6h", "2d")
        max_records: max articles to return (GDELT caps at 250)
        language: filter by language name ("Chinese", "English", None=all)
        rate_limit: seconds to wait between requests
    """
    params = {
        "query": query,
        "mode": "artlist",
        "maxrecords": min(max_records, 250),
        "timespan": timespan,
        "format": "json",
        "sort": "datedesc",
    }
    if language:
        params["query"] += f" sourcelang:{language.lower()}"

    try:
        time.sleep(rate_limit)
        delay = 1.0
        r = None
        for attempt in range(_MAX_RETRIES):
            try:
                r = httpx.get(_BASE, params=params, timeout=15, follow_redirects=True)
                r.raise_for_status()
                break
            except (httpx.HTTPError, httpx.TimeoutException) as exc:
                if attempt == _MAX_RETRIES - 1:
                    return []
                time.sleep(delay)
                delay *= 2
        data = r.json()
    except Exception:
        return []

    articles = []
    for item in data.get("articles") or []:
        title = item.get("title", "").strip()
        if not title:
            continue
        articles.append(NewsArticle(
            title=title,
            content=item.get("seendescription", "") or title,
            source=item.get("domain", "") or item.get("sourcecountry", ""),
            published_at=item.get("seendate", ""),
            url=item.get("url", ""),
            language="zh" if language == "Chinese" else "en",
        ))
    return articles


def fetch_supply_chain_news(
    themes: list[str] | None = None,
    timespan: str = "1d",
    max_per_query: int = 15,
) -> list[NewsArticle]:
    """Fetch supply-chain news for specified themes (or all themes if None)."""
    target = themes or list(SUPPLY_CHAIN_QUERIES.keys())
    all_articles: list[NewsArticle] = []
    seen_urls: set[str] = set()

    for theme in target:
        for query in SUPPLY_CHAIN_QUERIES.get(theme, []):
            articles = fetch(query, timespan=timespan, max_records=max_per_query)
            for a in articles:
                if a.url not in seen_urls and a.title:
                    seen_urls.add(a.url)
                    all_articles.append(a)

    return all_articles
