"""AKShare CN news fetcher.

Sources:
  - 财联社电报 (CLS): real-time supply-chain event signals
  - 东方财富关键词新闻 (EM): keyword-targeted A-share news
  - 金十数据 (JS): macro/commodity news affecting raw material costs

No API key required.
"""
from __future__ import annotations

from ..models import NewsArticle

_EM_KEYWORDS = [
    "MLCC", "碳化硅", "谐波减速器", "人形机器人", "HBM",
    "光模块", "储能", "液氧甲烷",
]


def fetch_cls_telegraph(n: int = 50) -> list[NewsArticle]:
    """财联社电报 — best source for supply-chain event signals."""
    try:
        import akshare as ak
        df = ak.stock_info_global_cls()
    except Exception:
        return []

    if df is None or df.empty:
        return []

    articles = []
    for _, row in df.head(n).iterrows():
        try:
            title = str(row.get("标题", "") or "")
            content = str(row.get("内容", "") or "")
            pub = str(row.get("时间", "") or "")
            if not title:
                continue
            articles.append(NewsArticle(
                title=title, content=content, source="财联社",
                published_at=pub, language="zh",
            ))
        except Exception:
            continue
    return articles


def fetch_em_news(keyword: str) -> list[NewsArticle]:
    """东方财富关键词新闻."""
    try:
        import akshare as ak
        df = ak.stock_news_em(symbol=keyword)
    except Exception:
        return []

    if df is None or df.empty:
        return []

    articles = []
    for _, row in df.iterrows():
        try:
            title = str(row.get("新闻标题", "") or "")
            content = str(row.get("新闻内容", "") or "")
            pub = str(row.get("发布时间", "") or "")
            if not title:
                continue
            articles.append(NewsArticle(
                title=title, content=content, source="东方财富",
                published_at=pub, language="zh",
            ))
        except Exception:
            continue
    return articles


def fetch_jinshi_macro() -> list[NewsArticle]:
    """金十数据 — macro/commodity news affecting raw material costs."""
    try:
        import akshare as ak
        df = ak.js_news()
    except Exception:
        return []

    if df is None or df.empty:
        return []

    articles = []
    for _, row in df.iterrows():
        try:
            title = str(row.get("标题", "") or "")
            content = str(row.get("内容", "") or "")
            pub = str(row.get("时间", "") or "")
            if not title:
                continue
            articles.append(NewsArticle(
                title=title, content=content, source="金十数据",
                published_at=pub, language="zh",
            ))
        except Exception:
            continue
    return articles


def fetch_all_akshare(em_keywords: list[str] | None = None) -> list[NewsArticle]:
    """Fetch from all AKShare sources and return combined list."""
    articles: list[NewsArticle] = []
    articles.extend(fetch_cls_telegraph())
    articles.extend(fetch_jinshi_macro())
    for kw in (em_keywords or _EM_KEYWORDS):
        articles.extend(fetch_em_news(kw))
    return articles
