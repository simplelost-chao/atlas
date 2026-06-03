import pytest
from industry_analysis.news.models import NewsArticle
from industry_analysis.news.pipeline import keyword_filter, SUPPLY_CHAIN_KEYWORDS


def _article(title: str, content: str = "", lang: str = "zh") -> NewsArticle:
    return NewsArticle(title=title, content=content,
                       source="test", published_at="2026-06-03T00:00:00Z",
                       language=lang)


def test_filter_keeps_article_with_keyword_in_title():
    articles = [_article("MLCC供应商扩产公告")]
    result = keyword_filter(articles)
    assert len(result) == 1


def test_filter_keeps_article_with_keyword_in_content():
    articles = [_article("市场动态", content="碳化硅功率器件需求大幅增长")]
    result = keyword_filter(articles)
    assert len(result) == 1


def test_filter_drops_irrelevant_article():
    articles = [_article("今日天气晴朗，适合出游", content="无关内容")]
    result = keyword_filter(articles)
    assert len(result) == 0


def test_filter_empty_list():
    assert keyword_filter([]) == []


def test_filter_min_hits_2_requires_two_keywords():
    # Only one keyword match
    articles = [_article("MLCC市场行情")]
    assert len(keyword_filter(articles, min_hits=2)) == 0

    # Two keyword matches
    articles2 = [_article("MLCC供应链缺货涨价")]
    assert len(keyword_filter(articles2, min_hits=2)) == 1


def test_filter_en_keyword_in_en_article():
    articles = [_article("HBM shortage drives NVIDIA revenue", lang="en")]
    result = keyword_filter(articles)
    assert len(result) == 1


def test_supply_chain_keywords_not_empty():
    assert len(SUPPLY_CHAIN_KEYWORDS) >= 10
