import pytest
from unittest.mock import patch, MagicMock
import pandas as pd
from industry_analysis.news.fetchers.akshare_news import (
    fetch_cls_telegraph, fetch_em_news, fetch_jinshi_macro,
    fetch_all_akshare,
)
from industry_analysis.news.models import NewsArticle


def _cls_df():
    return pd.DataFrame({
        "时间": ["2026-06-03 10:00:00"],
        "标题": ["MLCC供应商扩产公告"],
        "内容": ["国内MLCC龙头企业宣布扩产计划"],
    })


def _em_df():
    return pd.DataFrame({
        "发布时间": ["2026-06-03 11:00:00"],
        "新闻标题": ["碳化硅需求大增"],
        "新闻内容": ["碳化硅功率器件出货量创历史新高"],
    })


def _js_df():
    return pd.DataFrame({
        "时间": ["2026-06-03 12:00:00"],
        "标题": ["铝价上涨"],
        "内容": ["LME铝期货上涨2%"],
    })


def test_fetch_cls_telegraph_returns_articles():
    with patch("akshare.stock_info_global_cls", return_value=_cls_df()):
        articles = fetch_cls_telegraph(n=5)
    assert len(articles) == 1
    assert isinstance(articles[0], NewsArticle)
    assert "MLCC" in articles[0].title
    assert articles[0].source == "财联社"
    assert articles[0].language == "zh"


def test_fetch_em_news_returns_articles():
    with patch("akshare.stock_news_em", return_value=_em_df()):
        articles = fetch_em_news("碳化硅")
    assert len(articles) == 1
    assert articles[0].source == "东方财富"


def test_fetch_jinshi_macro_returns_articles():
    with patch("akshare.js_news", return_value=_js_df(), create=True):
        articles = fetch_jinshi_macro()
    assert len(articles) == 1
    assert articles[0].source == "金十数据"


def test_fetch_all_akshare_returns_combined():
    with patch("akshare.stock_info_global_cls", return_value=_cls_df()), \
         patch("akshare.js_news", return_value=_js_df(), create=True):
        articles = fetch_all_akshare()
    assert len(articles) >= 2


def test_fetch_cls_handles_empty_df():
    with patch("akshare.stock_info_global_cls", return_value=pd.DataFrame()):
        articles = fetch_cls_telegraph()
    assert articles == []
