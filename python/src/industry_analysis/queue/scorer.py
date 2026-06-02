"""7-dimension priority scoring for mining tasks.

From methodology doc (产业链挖掘驱动与任务队列方法论.md):

| Dimension           | Weight | High-score criteria |
|---------------------|-------:|---------------------|
| downstream_certainty|    20  | Large co. official release, clear capex, clear production timeline |
| increment_intensity |    15  | BOM usage, price, lead time, or order clearly changed |
| upstream_depth      |    15  | Can drill from system to component/material/equipment |
| bottleneck_prob     |    15  | Hard to substitute, slow to expand, concentrated supply |
| evidence_quality    |    15  | A/B grade sources (filings, patents, official release) |
| graph_gap           |    10  | Current graph.db doesn't cover or covers very shallowly |
| timeliness          |    10  | Today/this week signal, catalyst in next 3 months |

Total: 100. Interpret as:
  ≥80: Must expand today
  65-79: This week
  50-64: Watchlist
  <50: Skip
"""
from __future__ import annotations
from .models import MiningTask

# Evidence grade → evidence_quality score mapping
_GRADE_SCORE = {"A": 15, "B": 12, "C": 8, "D": 4, "E": 0}


def score(task: MiningTask, existing_node_ids: set[str] | None = None) -> int:
    """Compute 0-100 priority score. existing_node_ids from graph.db for gap detection."""
    total = 0

    # 1. Downstream certainty (0-20)
    # Proxy: driver_type + source_grade
    if task.driver_type == "news":
        certainty = {"A": 20, "B": 16, "C": 12, "D": 8, "E": 4}.get(task.source_grade, 8)
    elif task.driver_type == "anticipation":
        certainty = {"A": 15, "B": 12, "C": 9, "D": 6, "E": 3}.get(task.source_grade, 6)
    else:  # structural
        certainty = {"A": 18, "B": 14, "C": 10, "D": 7, "E": 3}.get(task.source_grade, 7)
    total += certainty

    # 2. Increment intensity (0-15)
    # Proxy: keywords in trigger_summary indicating real change
    _increment_kws = [
        "涨价", "降价", "交期", "缺货", "供应紧张", "产能不足", "BOM", "新款", "发布",
        "price increase", "shortage", "lead time", "capacity", "launch", "new product",
        "capex", "资本开支", "扩产", "订单激增",
    ]
    intensity_hits = sum(1 for kw in _increment_kws if kw.lower() in task.trigger_summary.lower())
    total += min(15, intensity_hits * 4)

    # 3. Upstream depth potential (0-15)
    # Proxy: number of suggested_expands + expected_layers
    depth_score = min(15, len(task.suggested_expands) * 3 + len(task.expected_layers) * 2)
    total += depth_score

    # 4. Bottleneck probability (0-15)
    _bottleneck_kws = [
        "卡脖子", "垄断", "唯一", "替代难", "认证", "specialized", "chokepoint",
        "monopoly", "hard to replace", "certification", "qualification",
        "出口管制", "export control", "sanctions", "制裁",
    ]
    bottleneck_hits = sum(1 for kw in _bottleneck_kws if kw.lower() in (task.trigger_summary + task.why_now).lower())
    total += min(15, bottleneck_hits * 5)

    # 5. Evidence quality (0-15)
    total += _GRADE_SCORE.get(task.source_grade, 4)

    # 6. Graph gap (0-10)
    if existing_node_ids is not None:
        from industry_analysis.graph.models import normalize
        root_key = normalize(task.root_node)
        gap_score = 10 if root_key not in existing_node_ids else 4
    else:
        gap_score = 7  # unknown: assume moderate gap
    total += gap_score

    # 7. Timeliness (0-10)
    # All tasks start at 7; decays by TTL (shorter TTL = more urgent)
    timeliness = max(2, 10 - max(0, task.ttl_days - 3))
    total += timeliness

    return min(100, total)


def interpret(score: int) -> str:
    if score >= 80:
        return "must-expand-today"
    elif score >= 65:
        return "this-week"
    elif score >= 50:
        return "watchlist"
    else:
        return "skip"
