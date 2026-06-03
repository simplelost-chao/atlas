"""ia daily orchestration: fetch → filter → scan → queue → optional auto-expand.

Fast driver (news) for the auto-mining system. Runs once per day.
Daily budget cap: at most DAILY_AUTO_EXPAND_LIMIT auto-expands per run.
Theme lock: skip auto-expand if the same theme already has an 'expanding' task.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from .graph.store import GraphStore
from .mining.engine import expand
from .news.models import NewsArticle
from .news.pipeline import keyword_filter
from .news.scanner import scan
from .queue.models import MiningTask
from .queue.scorer import score as compute_score
from .queue.store import QueueStore

DAILY_AUTO_EXPAND_LIMIT = 3  # max LLM expand calls triggered by ia daily


@dataclass
class DailyResult:
    articles_fetched: int = 0
    articles_after_filter: int = 0
    signals_found: int = 0
    tasks_queued: int = 0
    auto_expanded: int = 0
    elapsed_s: float = 0.0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"ia daily 摘要\n"
            f"  抓取文章: {self.articles_fetched} → 过滤后: {self.articles_after_filter}\n"
            f"  挖掘信号: {self.signals_found} → 入队: {self.tasks_queued}\n"
            f"  自动展开: {self.auto_expanded} (上限 {DAILY_AUTO_EXPAND_LIMIT})\n"
            f"  耗时: {self.elapsed_s:.0f}s"
        )


def _fetch_all_articles(since_hours: int = 24) -> list[NewsArticle]:
    """Fetch from all configured sources. Errors are swallowed per source."""
    articles: list[NewsArticle] = []

    try:
        from .news.fetchers.gdelt import fetch_supply_chain_news
        articles.extend(fetch_supply_chain_news(timespan=f"{since_hours}h",
                                                max_per_query=10))
    except Exception:
        pass

    try:
        from .news.fetchers.eastmoney import fetch_flash_news
        articles.extend(fetch_flash_news(since_hours=since_hours, max_records=30))
    except Exception:
        pass

    try:
        from .news.fetchers.akshare_news import fetch_all_akshare
        articles.extend(fetch_all_akshare())
    except Exception:
        pass

    try:
        from .news.fetchers.finviz import fetch_finviz_news
        articles.extend(fetch_finviz_news(max_articles=30))
    except Exception:
        pass

    return articles


def _is_theme_expanding(queue_store: QueueStore, theme_id: str) -> bool:
    """Return True if any task for this theme is currently 'expanding'."""
    expanding = queue_store.list(status="expanding")
    return any(t.root_node == theme_id for t in expanding)


def run_daily(
    store: GraphStore,
    client,
    queue_store: QueueStore,
    since_hours: int = 24,
    auto_expand_limit: int = DAILY_AUTO_EXPAND_LIMIT,
    dry_run: bool = False,
) -> DailyResult:
    """Orchestrate one daily news-driven mining cycle."""
    t0 = time.time()
    result = DailyResult()

    # 1. Fetch
    articles = _fetch_all_articles(since_hours)
    result.articles_fetched = len(articles)

    # 2. Keyword filter (~80% noise reduction)
    articles = keyword_filter(articles)
    result.articles_after_filter = len(articles)

    if not articles:
        result.elapsed_s = time.time() - t0
        return result

    # 3. Scan with QuantAgent
    try:
        scan_result = scan(articles, client, source_label="ia_daily")
        result.signals_found = len(scan_result.tasks)
        result.errors.extend(scan_result.errors)
    except Exception as e:
        result.errors.append(f"scan failed: {e}")
        result.elapsed_s = time.time() - t0
        return result

    if dry_run or not scan_result.tasks:
        result.elapsed_s = time.time() - t0
        return result

    # 4. Score and add to queue
    existing = {n.id for n in store.list_nodes()}
    for task in scan_result.tasks:
        if task.priority_score <= 0:
            task.priority_score = compute_score(task, existing)
        task.status = "queued"
        queue_store.add(task)
        result.tasks_queued += 1

    # 5. Auto-expand score >= 80, within daily budget, no theme lock
    high_priority = [t for t in scan_result.tasks if t.priority_score >= 80]
    high_priority.sort(key=lambda t: -t.priority_score)

    for task in high_priority:
        if result.auto_expanded >= auto_expand_limit:
            break
        if _is_theme_expanding(queue_store, task.root_node):
            continue
        if not store.get_node(task.root_node):
            continue
        try:
            queue_store.update_status(task.id, "expanding")
            expand(store, client, task.root_node)
            queue_store.update_status(task.id, "done")
            result.auto_expanded += 1
        except Exception as e:
            queue_store.update_status(task.id, "queued")
            result.errors.append(f"auto-expand {task.root_node}: {e}")

    result.elapsed_s = time.time() - t0
    return result
