"""Keyword pre-filter for news articles.

Applied between fetchers and QuantAgent scanner to drop irrelevant articles.
Reduces LLM token usage by ~80% by only passing supply-chain-relevant articles.
"""
from __future__ import annotations

from .models import NewsArticle

SUPPLY_CHAIN_KEYWORDS = [
    # Event-type signals (high value)
    "涨价", "缺货", "扩产", "产能", "交期", "供应紧张", "出口管制",
    "price increase", "shortage", "capacity expansion", "lead time",
    "supply chain", "bottleneck", "sanctions", "export control",
    # Track keywords — CN
    "MLCC", "积层陶瓷", "钛酸钡", "镍粉",
    "HBM", "CoWoS", "先进封装", "光模块", "算力", "数据中心",
    "谐波减速器", "RV减速器", "伺服电机", "人形机器人", "工业机器人",
    "碳化硅", "SiC", "储能", "光伏",
    "液氧甲烷", "火箭发动机",
    "激光雷达", "自动驾驶",
    "基因测序", "液体活检",
    # Track keywords — EN
    "harmonic drive", "humanoid", "HBM memory", "CoWoS",
    "silicon carbide", "energy storage", "solid-state battery",
    "reusable rocket", "lidar", "autonomous",
]

_KEYWORDS_LOWER = [k.lower() for k in SUPPLY_CHAIN_KEYWORDS]


def keyword_filter(
    articles: list[NewsArticle],
    min_hits: int = 1,
) -> list[NewsArticle]:
    """Keep articles that contain at least `min_hits` supply-chain keywords.

    Checks both title and content (case-insensitive).
    Drops ~80% of irrelevant articles before they reach QuantAgent.
    """
    result = []
    for a in articles:
        text = ((a.title or "") + " " + (a.content or "")).lower()
        hits = sum(1 for kw in _KEYWORDS_LOWER if kw in text)
        if hits >= min_hits:
            result.append(a)
    return result
