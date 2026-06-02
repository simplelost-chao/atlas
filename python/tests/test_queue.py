"""Tests for mining task queue (PR5)."""
import pytest
from pathlib import Path
from industry_analysis.queue.models import MiningTask, _now
from industry_analysis.queue.store import QueueStore
from industry_analysis.queue.scorer import score, interpret


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def qs(tmp_path):
    return QueueStore(tmp_path / "graph.db")


def _make_task(**kwargs) -> MiningTask:
    defaults = dict(
        id="", driver_type="news",
        trigger_summary="NVIDIA launches Blackwell Ultra, new AI server architecture",
        root_node="AI服务器散热模组",
        source="gdelt", source_grade="B",
        why_now="New BOM requires higher thermal dissipation",
        ttl_days=7,
    )
    defaults.update(kwargs)
    return MiningTask(**defaults)


# ── QueueStore ───────────────────────────────────────────────────────────────

class TestQueueStore:
    def test_add_assigns_id(self, qs):
        task = qs.add(_make_task())
        assert task.id != ""

    def test_get_roundtrip(self, qs):
        task = qs.add(_make_task(trigger_summary="test signal"))
        fetched = qs.get(task.id)
        assert fetched is not None
        assert fetched.trigger_summary == "test signal"
        assert fetched.root_node == "AI服务器散热模组"

    def test_list_by_status(self, qs):
        qs.add(_make_task(trigger_summary="a"))
        qs.add(_make_task(trigger_summary="b"))
        tasks = qs.list(status="inbox")
        assert len(tasks) == 2

    def test_update_status(self, qs):
        task = qs.add(_make_task())
        qs.update_status(task.id, "done")
        fetched = qs.get(task.id)
        assert fetched.status == "done"

    def test_update_score_moves_to_queued(self, qs):
        task = qs.add(_make_task())
        qs.update_score(task.id, 75)
        fetched = qs.get(task.id)
        assert fetched.priority_score == 75
        assert fetched.status == "queued"

    def test_next_task_returns_highest_priority(self, qs):
        t1 = qs.add(_make_task(trigger_summary="low"))
        t2 = qs.add(_make_task(trigger_summary="high"))
        qs.update_score(t1.id, 60)
        qs.update_score(t2.id, 85)
        next_task = qs.next_task()
        assert next_task is not None
        assert next_task.priority_score == 85

    def test_expire_stale_moves_to_monitor(self, qs):
        task = _make_task(ttl_days=0)  # expires immediately
        task.signal_date = "2020-01-01T00:00:00+00:00"  # in the past
        qs.add(task)
        expired = qs.expire_stale()
        assert expired == 1
        fetched = qs.get(qs.list()[0].id)
        assert fetched.status == "monitor"

    def test_suggested_expands_roundtrip(self, qs):
        task = _make_task()
        task.suggested_expands = ["液冷散热", "vapor chamber", "TIM材料"]
        task.expected_layers = ["材料前驱体层", "工艺设备层"]
        t = qs.add(task)
        fetched = qs.get(t.id)
        assert fetched.suggested_expands == ["液冷散热", "vapor chamber", "TIM材料"]
        assert fetched.expected_layers == ["材料前驱体层", "工艺设备层"]


# ── Scorer ───────────────────────────────────────────────────────────────────

class TestScorer:
    def test_high_quality_news_scores_high(self):
        task = _make_task(
            driver_type="news",
            source_grade="A",
            trigger_summary="NVIDIA Blackwell供应链扩产 涨价 缺货 认证",
            why_now="垄断 卡脖子 出口管制",
            suggested_expands=["液冷散热", "VRM电源模块", "先进封装"],
            expected_layers=["工艺设备层", "材料前驱体层"],
            ttl_days=3,
        )
        s = score(task)
        assert s >= 65, f"expected ≥65, got {s}"

    def test_d_grade_structural_scores_lower(self):
        task = _make_task(source_grade="D", driver_type="structural")
        s = score(task)
        assert s < 65

    def test_graph_gap_boosts_score(self):
        task = _make_task(root_node="brandnewunknownnode12345")
        with_gap = score(task, existing_node_ids=set())
        without_gap = score(task, existing_node_ids={"brandnewunknownnode12345"})
        assert with_gap > without_gap

    def test_interpret_thresholds(self):
        assert interpret(85) == "must-expand-today"
        assert interpret(72) == "this-week"
        assert interpret(55) == "watchlist"
        assert interpret(40) == "skip"


# ── MiningTask model ─────────────────────────────────────────────────────────

class TestMiningTask:
    def test_ttl_expires_in_future(self):
        task = _make_task(ttl_days=7)
        assert not task.is_expired

    def test_ttl_expired_in_past(self):
        task = _make_task(ttl_days=0)
        task.signal_date = "2020-01-01T00:00:00+00:00"
        assert task.is_expired
