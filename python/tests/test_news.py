"""Tests for news fetchers and scanner (PR6)."""
import json
import pytest
from unittest.mock import MagicMock, patch
from industry_analysis.news.models import NewsArticle
from industry_analysis.news.fetchers.gdelt import fetch, SUPPLY_CHAIN_QUERIES
from industry_analysis.news.scanner import scan, _parse_signals, _signal_to_task, _build_scan_prompt


# ── NewsArticle ──────────────────────────────────────────────────────────────

class TestNewsArticle:
    def test_as_prompt_text_truncates(self):
        a = NewsArticle(title="Test", content="x" * 1000, source="Reuters", published_at="2026-06-02")
        text = a.as_prompt_text(max_chars=100)
        assert len(text) < 200
        assert "Test" in text

    def test_as_prompt_text_includes_source_date(self):
        a = NewsArticle(title="T", content="c", source="Xinhua", published_at="2026-06-02T10:00:00")
        text = a.as_prompt_text()
        assert "Xinhua" in text
        assert "2026-06-02" in text


# ── GDELT fetch (mocked HTTP) ────────────────────────────────────────────────

class TestGdeltFetch:
    def _mock_response(self, articles):
        mock = MagicMock()
        mock.status_code = 200
        mock.json.return_value = {"articles": articles}
        mock.raise_for_status = MagicMock()
        return mock

    def test_fetch_returns_articles(self):
        fake_articles = [
            {"title": "NVIDIA supply chain expands", "domain": "reuters.com",
             "seendescription": "NVIDIA is expanding its CoWoS supply chain.",
             "seendate": "2026-06-02T10:00:00Z", "url": "https://reuters.com/1"},
        ]
        with patch("httpx.get", return_value=self._mock_response(fake_articles)):
            results = fetch("NVIDIA supply chain", timespan="1d", rate_limit=0)
        assert len(results) == 1
        assert results[0].title == "NVIDIA supply chain expands"
        assert results[0].source == "reuters.com"

    def test_fetch_returns_empty_on_error(self):
        with patch("httpx.get", side_effect=Exception("network error")):
            results = fetch("test", rate_limit=0)
        assert results == []

    def test_fetch_dedupes_empty_titles(self):
        fake_articles = [
            {"title": "", "domain": "x.com", "seendescription": "d", "seendate": "2026", "url": "u1"},
            {"title": "Real article", "domain": "y.com", "seendescription": "d2", "seendate": "2026", "url": "u2"},
        ]
        with patch("httpx.get", return_value=self._mock_response(fake_articles)):
            results = fetch("test", rate_limit=0)
        # Empty title article should not appear
        assert all(r.title for r in results)

    def test_supply_chain_queries_have_all_themes(self):
        assert "ai_chip" in SUPPLY_CHAIN_QUERIES
        assert "robotics" in SUPPLY_CHAIN_QUERIES
        assert "space" in SUPPLY_CHAIN_QUERIES
        assert "new_energy" in SUPPLY_CHAIN_QUERIES
        # Each theme has both CN and EN queries
        for theme, queries in SUPPLY_CHAIN_QUERIES.items():
            assert len(queries) >= 2, f"{theme} needs both CN and EN queries"


# ── Scanner ───────────────────────────────────────────────────────────────────

class TestScanner:
    def _articles(self):
        return [
            NewsArticle(
                title="谐波减速器龙头扩产50%，供应紧张缓解预期",
                content="国内某谐波减速器厂商宣布扩产，产能将提升50%，主要用于人形机器人供应链...",
                source="财联社", published_at="2026-06-02T10:00:00",
            ),
            NewsArticle(
                title="今天天气不错",
                content="今日晴天，气温适宜",
                source="天气网", published_at="2026-06-02",
            ),
        ]

    def test_parse_signals_extracts_json(self):
        raw = '{"signals":[{"driver_type":"news","trigger_summary":"谐波减速器扩产","root_node":"谐波减速器","source_grade":"C","ttl_days":7,"priority_score":70,"why_now":"供应链变化","suggested_expands":[],"expected_layers":[]}]}'
        signals = _parse_signals(raw)
        assert len(signals) == 1
        assert signals[0]["root_node"] == "谐波减速器"

    def test_parse_signals_returns_empty_on_garbage(self):
        assert _parse_signals("no json here") == []
        assert _parse_signals('{"signals": []}') == []

    def test_signal_to_task_converts(self):
        sig = {
            "driver_type": "news", "trigger_summary": "谐波减速器扩产",
            "root_node": "谐波减速器主轴承", "source_grade": "B",
            "ttl_days": 7, "priority_score": 75,
            "why_now": "人形机器人需求放量",
            "suggested_expands": ["精密钢球", "轴承钢"],
            "expected_layers": ["材料前驱体层"],
        }
        task = _signal_to_task(sig, "test")
        assert task is not None
        assert task.root_node == "谐波减速器主轴承"
        assert task.priority_score == 75
        assert task.suggested_expands == ["精密钢球", "轴承钢"]

    def test_signal_to_task_skips_low_priority(self):
        sig = {"driver_type": "news", "trigger_summary": "t",
               "root_node": "r", "source_grade": "D", "priority_score": 40,
               "ttl_days": 7}
        assert _signal_to_task(sig, "test") is None

    def test_scan_with_fake_client(self):
        fake_raw = json.dumps({"signals": [
            {"driver_type": "news", "trigger_summary": "谐波减速器扩产50%",
             "root_node": "谐波减速器精密零件", "source_grade": "C",
             "priority_score": 72, "ttl_days": 7,
             "why_now": "人形机器人需求", "suggested_expands": [], "expected_layers": []},
        ]})

        class FakeClient:
            def run(self, agent, prompt):
                return fake_raw

        result = scan(self._articles(), FakeClient(), source_label="test")
        assert result.articles_scanned == 2
        assert result.batches_run == 1
        assert len(result.tasks) == 1
        assert result.tasks[0].root_node == "谐波减速器精密零件"

    def test_scan_empty_articles_returns_empty(self):
        class FakeClient:
            def run(self, agent, prompt):
                return '{"signals":[]}'
        result = scan([], FakeClient())
        assert result.tasks == []
        assert result.articles_scanned == 0

    def test_build_scan_prompt_includes_articles(self):
        articles = [
            NewsArticle(title="Test1", content="c1", source="S", published_at="2026"),
            NewsArticle(title="Test2", content="c2", source="S", published_at="2026"),
        ]
        prompt = _build_scan_prompt(articles)
        assert "[1]" in prompt
        assert "[2]" in prompt
        assert "Test1" in prompt
        assert "Test2" in prompt
