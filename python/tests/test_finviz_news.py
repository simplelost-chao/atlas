import pytest
from unittest.mock import patch, MagicMock
from industry_analysis.news.fetchers.finviz import fetch_finviz_news, fetch_finviz_ticker
from industry_analysis.news.models import NewsArticle


def _news_row():
    return {"title": "NVIDIA supply chain tight", "date": "06/03/2026",
            "link": "https://example.com/1", "source": "Reuters"}


def test_fetch_finviz_news_returns_articles():
    mock_news = MagicMock()
    mock_news.get_news.return_value = {"news": [_news_row(), _news_row()]}
    with patch("finvizfinance.news.News", return_value=mock_news):
        articles = fetch_finviz_news()
    assert len(articles) == 2
    assert isinstance(articles[0], NewsArticle)
    assert articles[0].source == "Reuters"
    assert articles[0].language == "en"


def test_fetch_finviz_news_empty():
    mock_news = MagicMock()
    mock_news.get_news.return_value = {"news": []}
    with patch("finvizfinance.news.News", return_value=mock_news):
        articles = fetch_finviz_news()
    assert articles == []


def test_fetch_finviz_ticker_returns_articles():
    mock_quote = MagicMock()
    mock_quote.ticker_news.return_value = [_news_row()]
    with patch("finvizfinance.quote.finvizfinance", return_value=mock_quote):
        articles = fetch_finviz_ticker("NVDA")
    assert len(articles) == 1
    assert articles[0].language == "en"


def test_fetch_finviz_handles_exception_gracefully():
    with patch("finvizfinance.news.News", side_effect=Exception("network error")):
        articles = fetch_finviz_news()
    assert articles == []
