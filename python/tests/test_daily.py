import pytest
from unittest.mock import MagicMock, patch
from industry_analysis.news.models import NewsArticle
from industry_analysis.daily import run_daily, DailyResult, DAILY_AUTO_EXPAND_LIMIT
from industry_analysis.queue.models import MiningTask
from industry_analysis.queue.store import QueueStore
from industry_analysis.graph.models import Node, NodeType, NodeStatus
from industry_analysis.graph.store import GraphStore


def _article(title: str) -> NewsArticle:
    return NewsArticle(title=title, content=title, source="test",
                       published_at="2026-06-03T00:00:00Z")


def _task(root_node: str, score: int = 85) -> MiningTask:
    from industry_analysis.queue.models import _now
    return MiningTask(
        id="t1", driver_type="news",
        trigger_summary=f"signal for {root_node}",
        root_node=root_node, priority_score=score,
        signal_date=_now(), created_at=_now(), updated_at=_now(),
    )


@pytest.fixture
def store(tmp_path):
    s = GraphStore(str(tmp_path / "graph.db"))
    s.upsert_node(Node(id="robotics", name_cn="机器人", name_en="Robotics",
                       node_type=NodeType.theme, theme_ids=["robotics"],
                       status=NodeStatus.confirmed))
    return s


@pytest.fixture
def queue_store(tmp_path):
    return QueueStore(tmp_path / "graph.db")


def test_run_daily_returns_daily_result(store, queue_store, tmp_path):
    with patch("industry_analysis.daily._fetch_all_articles", return_value=[]), \
         patch("industry_analysis.daily.keyword_filter", return_value=[]), \
         patch("industry_analysis.daily.scan") as mock_scan:
        from industry_analysis.news.scanner import ScanResult
        mock_scan.return_value = ScanResult(tasks=[], articles_scanned=0,
                                             batches_run=0, errors=[])
        result = run_daily(store, MagicMock(), queue_store, dry_run=True)
    assert isinstance(result, DailyResult)


def test_run_daily_adds_tasks_to_queue(store, queue_store):
    task = _task("robotics", score=60)
    with patch("industry_analysis.daily._fetch_all_articles",
               return_value=[_article("谐波减速器缺货")]), \
         patch("industry_analysis.daily.keyword_filter",
               return_value=[_article("谐波减速器缺货")]), \
         patch("industry_analysis.daily.scan") as mock_scan:
        from industry_analysis.news.scanner import ScanResult
        mock_scan.return_value = ScanResult(tasks=[task], articles_scanned=1,
                                             batches_run=1, errors=[])
        result = run_daily(store, MagicMock(), queue_store)
    assert result.tasks_queued == 1
    assert queue_store.next_task() is not None


def test_run_daily_auto_expand_respects_budget(store, queue_store):
    """Auto-expand stops after DAILY_AUTO_EXPAND_LIMIT tasks."""
    tasks = [_task(f"node{i}", score=90) for i in range(10)]
    with patch("industry_analysis.daily._fetch_all_articles",
               return_value=[_article("HBM扩产")]), \
         patch("industry_analysis.daily.keyword_filter",
               return_value=[_article("HBM扩产")]), \
         patch("industry_analysis.daily.scan") as mock_scan, \
         patch("industry_analysis.daily.expand") as mock_expand:
        from industry_analysis.news.scanner import ScanResult
        mock_scan.return_value = ScanResult(tasks=tasks, articles_scanned=1,
                                             batches_run=1, errors=[])
        mock_expand.return_value = {"created": 1, "linked": 0, "skipped": 0}
        result = run_daily(store, MagicMock(), queue_store)
    assert result.auto_expanded <= DAILY_AUTO_EXPAND_LIMIT


def test_run_daily_dry_run_does_not_queue(store, queue_store):
    task = _task("robotics", score=90)
    with patch("industry_analysis.daily._fetch_all_articles",
               return_value=[_article("MLCC缺货")]), \
         patch("industry_analysis.daily.keyword_filter",
               return_value=[_article("MLCC缺货")]), \
         patch("industry_analysis.daily.scan") as mock_scan:
        from industry_analysis.news.scanner import ScanResult
        mock_scan.return_value = ScanResult(tasks=[task], articles_scanned=1,
                                             batches_run=1, errors=[])
        result = run_daily(store, MagicMock(), queue_store, dry_run=True)
    assert result.tasks_queued == 0
    assert queue_store.next_task() is None
