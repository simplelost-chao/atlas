"""News signal scanner: batch articles → QuantAgent → MiningTask list.

This is the intelligence layer: raw news articles go in,
structured mining signals come out, ready for ia queue add.

Batching strategy: group articles into batches of ~10 and call
QuantAgent once per batch. This reduces API calls while keeping
context manageable.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from ..queue.models import MiningTask, _now
from .models import NewsArticle


_BATCH_SIZE = 10  # articles per QuantAgent call


@dataclass
class ScanResult:
    tasks: list[MiningTask]
    articles_scanned: int
    batches_run: int
    errors: list[str]


def _build_scan_prompt(articles: list[NewsArticle]) -> str:
    lines = []
    for i, a in enumerate(articles, 1):
        lines.append(f"[{i}] {a.as_prompt_text(max_chars=350)}")
    return "以下是今日新闻文章，请提取产业链挖掘信号：\n\n" + "\n\n".join(lines)


def _parse_signals(raw: str) -> list[dict]:
    """Extract JSON from QuantAgent output."""
    # Try to find JSON object
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
        return data.get("signals") or []
    except (json.JSONDecodeError, AttributeError):
        return []


def _signal_to_task(sig: dict, source_label: str) -> MiningTask | None:
    trigger = sig.get("trigger_summary", "").strip()
    root = sig.get("root_node", "").strip()
    if not trigger or not root:
        return None
    score = int(sig.get("priority_score", 50))
    if score < 50:  # below threshold — skip
        return None
    return MiningTask(
        id="",
        driver_type=sig.get("driver_type", "news"),
        trigger_summary=trigger,
        root_node=root,
        source=source_label,
        source_grade=sig.get("source_grade", "D"),
        why_now=sig.get("why_now", ""),
        suggested_expands=sig.get("suggested_expands") or [],
        expected_layers=sig.get("expected_layers") or [],
        ttl_days=int(sig.get("ttl_days", 7)),
        priority_score=score,
        signal_date=_now(),
        created_at=_now(),
        updated_at=_now(),
    )


def scan(
    articles: list[NewsArticle],
    client,  # QuantAgentClient
    agent: str = "news-scanner",
    source_label: str = "news_scan",
) -> ScanResult:
    """Run news-scanner agent over batches of articles, return MiningTask list."""
    tasks: list[MiningTask] = []
    errors: list[str] = []
    batches = 0

    if not articles:
        return ScanResult(tasks=[], articles_scanned=0, batches_run=0, errors=[])

    # Split into batches
    for i in range(0, len(articles), _BATCH_SIZE):
        batch = articles[i:i + _BATCH_SIZE]
        prompt = _build_scan_prompt(batch)
        try:
            raw = client.run(agent, prompt)
            signals = _parse_signals(raw)
            for sig in signals:
                task = _signal_to_task(sig, source_label)
                if task:
                    tasks.append(task)
            batches += 1
        except Exception as e:
            errors.append(f"batch {i//10}: {e}")

    return ScanResult(
        tasks=tasks,
        articles_scanned=len(articles),
        batches_run=batches,
        errors=errors,
    )
