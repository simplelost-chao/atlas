"""East Money (东方财富) real-time flash news fetcher.

Uses the public 财联社快讯 endpoint via 东方财富's open API.
No API key required. Rate limit: be polite (~1 req/sec).

Flash news (快讯) covers: A-share announcements, market catalysts,
supply-chain events, government policy, company earnings flash.
"""
from __future__ import annotations

import time
import httpx
from ..models import NewsArticle

# 东方财富 flash news endpoint (财联社快讯)
_FLASH_URL = "https://np-anotice-stock.eastmoney.com/api/security/ann"

# Alternative: 东方财富 公告 (company announcements)
_ANN_URL = "https://np-anotice-stock.eastmoney.com/api/security/ann"

# Supply-chain relevant keywords for A-share news
_SUPPLY_CHAIN_KEYWORDS = [
    # 机器人
    "机器人", "谐波减速器", "伺服电机", "人形机器人", "工业机器人",
    # 半导体/AI
    "芯片", "半导体", "AI", "人工智能", "存储", "光模块", "算力",
    # 新能源
    "锂电", "固态电池", "稀土", "光伏", "储能",
    # 航天
    "航天", "卫星", "火箭",
    # 供应链信号
    "供应链", "扩产", "产能", "订单", "涨价", "出口管制",
]


def fetch_flash_news(
    since_hours: int = 24,
    max_records: int = 30,
    rate_limit: float = 1.0,
) -> list[NewsArticle]:
    """Fetch recent flash news from 财联社 via 东方财富 API.

    Returns supply-chain relevant items filtered by keywords.
    """
    # 东方财富快讯 endpoint
    # Note: This is the public endpoint used by their web app
    url = "https://finance.eastmoney.com/api/flash"
    params = {
        "client": "web",
        "biz": "web_stock",
        "pageindex": 1,
        "pagesize": max_records,
        "callback": "",
        "type": 0,
    }

    articles: list[NewsArticle] = []
    try:
        time.sleep(rate_limit)
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; IndustryAnalysis/1.0)",
            "Referer": "https://finance.eastmoney.com/",
        }
        r = httpx.get(url, params=params, headers=headers, timeout=10, follow_redirects=True)
        if r.status_code != 200:
            return []
        data = r.json()
        items = data.get("data", {}).get("list", []) if isinstance(data, dict) else []
        for item in items:
            title = item.get("title", "") or item.get("content", "")[:80]
            content = item.get("content", "") or title
            if not title:
                continue
            # Filter to supply-chain relevant
            combined = (title + content).lower()
            if not any(kw in combined for kw in _SUPPLY_CHAIN_KEYWORDS):
                continue
            articles.append(NewsArticle(
                title=title,
                content=content[:500],
                source="财联社/东方财富",
                published_at=item.get("datetime", "") or item.get("created_at", ""),
                url=item.get("url", ""),
                language="zh",
            ))
    except Exception:
        pass

    return articles


def fetch_announcements(
    keywords: list[str] | None = None,
    since_days: int = 1,
    max_records: int = 20,
) -> list[NewsArticle]:
    """Fetch company announcements from East Money.

    These are official A-share company disclosures — highest quality signal source.
    Filters to supply-chain relevant announcements by keyword.
    """
    kws = keywords or _SUPPLY_CHAIN_KEYWORDS[:10]
    articles: list[NewsArticle] = []

    for kw in kws[:5]:  # limit to avoid too many requests
        try:
            time.sleep(0.5)
            params = {
                "sr": -1,
                "pageSize": 10,
                "page": 1,
                "column": "szse,sse",
                "tabName": "fulltext",
                "searchKey": kw,
                "sortName": "time",
                "sortType": "desc",
                "isHLtitle": 1,
            }
            headers = {"User-Agent": "Mozilla/5.0 (compatible; IndustryAnalysis/1.0)"}
            r = httpx.get(_ANN_URL, params=params, headers=headers, timeout=10)
            if r.status_code != 200:
                continue
            data = r.json()
            for item in (data.get("data", {}).get("list") or [])[:4]:
                title = item.get("title", "")
                code = item.get("codes", [{}])[0].get("sCode", "")
                name = item.get("codes", [{}])[0].get("sName", "")
                articles.append(NewsArticle(
                    title=f"[{code} {name}] {title}",
                    content=title,
                    source="东方财富公告",
                    published_at=item.get("noticeTime", ""),
                    url=item.get("attachedOriginalUrl", ""),
                    language="zh",
                    tags=[kw],
                ))
        except Exception:
            continue

    return articles
