import json as _json
from typing import Optional
import typer
from industry_analysis.config import get_settings
from industry_analysis.graph.store import GraphStore
from industry_analysis.graph.models import NodeType, NodeStatus
from industry_analysis.quantagent.client import QuantAgentClient
from industry_analysis.mining.engine import expand as _expand, batch_expand as _batch
from industry_analysis.themes.loader import load_themes
from industry_analysis.review import queue

app = typer.Typer(no_args_is_help=True)
theme_app = typer.Typer()
node_app = typer.Typer()
review_app = typer.Typer()
queue_app = typer.Typer()
news_app = typer.Typer()
app.add_typer(theme_app, name="theme")
app.add_typer(node_app, name="node")
app.add_typer(review_app, name="review")
app.add_typer(queue_app, name="queue")
app.add_typer(news_app, name="news")


def _store() -> GraphStore:
    return GraphStore(get_settings().resolved_db_path())


def _client() -> QuantAgentClient:
    s = get_settings()
    return QuantAgentClient(s.quantagent_cli, s.quantagent_agents_dir, s.node_path, s.quantagent_timeout)


def _emit(obj, as_json: bool):
    if as_json:
        typer.echo(_json.dumps(obj, ensure_ascii=False, default=str))
    else:
        typer.echo(obj)


@theme_app.command("load")
def theme_load(seed: str = "seeds/ark_themes_2026.yaml"):
    typer.echo(f"loaded {load_themes(_store(), seed)} themes")


@node_app.command("list")
def node_list(
    type: Optional[str] = None,
    theme: Optional[str] = None,
    status: Optional[str] = None,
    json: bool = False,
):
    s = _store()
    nodes = s.list_nodes(
        status=NodeStatus(status) if status else None,
        node_type=NodeType(type) if type else None,
        theme_id=theme,
    )
    _emit([n.model_dump(mode="json") for n in nodes] if json
          else "\n".join(f"{n.id}\t{n.node_type.value}\t{n.name_cn}" for n in nodes), json)


@node_app.command("show")
def node_show(node_id: str, json: bool = False):
    n = _store().get_node(node_id)
    _emit(n.model_dump(mode="json") if (n and json) else (str(n) if n else "not found"), json and n)


@node_app.command("path")
def node_path(node_id: str):
    typer.echo(" → ".join(n.name_cn for n in reversed(_store().path_to_root(node_id))))


def _datasource_db():
    from industry_analysis.datasource.store.datasource_db import DataSourceDB
    cfg = get_settings()
    p = cfg.resolved_datasource_db()
    if p:
        return DataSourceDB(p)
    return None


@app.command()
def expand(node_id: str, auto_depth: int = 1, json: bool = False):
    s, c = _store(), _client()
    cfg = get_settings()
    ds = _datasource_db()
    res = (_batch(s, c, node_id, depth=auto_depth, auto_confirm_grade=cfg.auto_confirm_grade,
                  datasource_db=ds) if auto_depth > 1
           else _expand(s, c, node_id, auto_confirm_grade=cfg.auto_confirm_grade,
                        datasource_db=ds))
    _emit(res, json)


@app.command()
def search(keyword: str, json: bool = False):
    kw = keyword.lower()
    hits = [n for n in _store().list_nodes()
            if kw in n.name_cn.lower() or kw in n.name_en.lower() or kw in n.description.lower()]
    _emit([n.model_dump(mode="json") for n in hits] if json
          else "\n".join(f"{n.id}\t{n.name_cn}" for n in hits), json)


@app.command()
def chokepoints(min_themes: int = 2, json: bool = False):
    cps = _store().chokepoints(min_themes)
    _emit([n.model_dump(mode="json") for n in cps] if json
          else "\n".join(f"{n.id}\t{n.theme_ids}\t{n.name_cn}" for n in cps), json)


@review_app.command("list")
def review_list(json: bool = False):
    nodes = queue.pending(_store())
    _emit([n.model_dump(mode="json") for n in nodes] if json
          else "\n".join(f"{n.id}\t{n.name_cn}" for n in nodes), json)


@review_app.command("approve")
def review_approve(node_id: str):
    queue.approve(_store(), node_id); typer.echo(f"approved {node_id}")


@review_app.command("reject")
def review_reject(node_id: str):
    queue.reject(_store(), node_id); typer.echo(f"rejected {node_id}")


@review_app.command("merge")
def review_merge(node_id: str, into: str):
    queue.merge(_store(), node_id, into); typer.echo(f"merged {node_id} into {into}")


@app.command("export")
def graph_export(out: str = "graph.json"):
    import json as j
    open(out, "w", encoding="utf-8").write(j.dumps(_store().export(), ensure_ascii=False, indent=2))
    typer.echo(f"exported -> {out}")


@app.command("sync")
def graph_sync(
    chain_id: str = typer.Argument(..., help="Atlas IndustryChain.id to sync into"),
    db_url: Optional[str] = typer.Option(None, "--db-url", help="Postgres URL (overrides IA_ATLAS_DB_URL)"),
    theme: Optional[str] = typer.Option(None, "--theme", help="Only sync nodes with this theme_id"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print what would be done, no writes"),
    json: bool = False,
):
    """Sync confirmed Python CLI nodes into Atlas Postgres (one-way, idempotent)."""
    from industry_analysis.sync.atlas_sync import sync_to_postgres

    url = db_url or get_settings().atlas_db_url
    if not url:
        typer.echo("ERROR: Postgres URL required. Set IA_ATLAS_DB_URL or pass --db-url", err=True)
        raise typer.Exit(1)

    result = sync_to_postgres(_store(), url, chain_id, dry_run=dry_run, theme_filter=theme)

    summary = {
        "nodes_upserted": result.nodes_upserted,
        "nodes_skipped": result.nodes_skipped,
        "edges_upserted": result.edges_upserted,
        "edges_skipped": result.edges_skipped,
        "errors": result.errors,
    }
    if json:
        _emit(summary, True)
    else:
        typer.echo(
            f"Sync complete: nodes={result.nodes_upserted} new / {result.nodes_skipped} updated"
            f", edges={result.edges_upserted} new / {result.edges_skipped} skipped"
        )
        if result.errors:
            for e in result.errors:
                typer.echo(f"  ERROR: {e}", err=True)


# ── ia queue ────────────────────────────────────────────────────────────────

def _qstore():
    from industry_analysis.queue.store import QueueStore
    return QueueStore(get_settings().resolved_db_path())


@queue_app.command("add")
def queue_add(
    trigger: str = typer.Argument(..., help="One-line signal description"),
    node: str = typer.Option(..., "--node", "-n", help="Root node to expand"),
    driver: str = typer.Option("news", "--driver", "-d", help="news|anticipation|structural"),
    source: str = typer.Option("manual", "--source", help="Signal source label"),
    grade: str = typer.Option("C", "--grade", help="Evidence grade A-E"),
    ttl: int = typer.Option(7, "--ttl", help="TTL in days"),
    why: str = typer.Option("", "--why", help="Why now?"),
    json: bool = False,
):
    """Add a mining signal to the queue."""
    from industry_analysis.queue.models import MiningTask
    from industry_analysis.queue.scorer import score as compute_score
    qs = _qstore()
    s = _store()
    existing = {n.id for n in s.list_nodes()}
    task = MiningTask(
        id="", driver_type=driver, trigger_summary=trigger,
        root_node=node, source=source, source_grade=grade,
        why_now=why, ttl_days=ttl,
    )
    task.priority_score = compute_score(task, existing)
    task = qs.add(task)
    if json:
        _emit({"id": task.id, "priority_score": task.priority_score, "status": task.status}, True)
    else:
        from industry_analysis.queue.scorer import interpret
        typer.echo(f"added {task.id} | score={task.priority_score} ({interpret(task.priority_score)}) | node={node}")


@queue_app.command("list")
def queue_list(
    status: Optional[str] = typer.Option(None, "--status", help="inbox|queued|expanding|done"),
    min_score: int = typer.Option(0, "--min-score"),
    json: bool = False,
):
    """List mining tasks in the queue."""
    from industry_analysis.queue.scorer import interpret
    tasks = _qstore().list(status=status, min_score=min_score)
    if json:
        _emit([t.__dict__ for t in tasks], True)
    else:
        if not tasks:
            typer.echo("(empty)")
            return
        for t in tasks:
            typer.echo(f"[{t.id}] score={t.priority_score:3d} ({interpret(t.priority_score):20s}) "
                       f"[{t.driver_type:12s}] [{t.source_grade}] {t.trigger_summary[:60]}")
            typer.echo(f"       node={t.root_node} | status={t.status} | ttl={t.ttl_days}d")


@queue_app.command("next")
def queue_next(json: bool = False):
    """Show the highest-priority queued task (ready to expand)."""
    from industry_analysis.queue.scorer import interpret
    # Auto-score inbox tasks first
    qs = _qstore()
    s = _store()
    existing = {n.id for n in s.list_nodes()}
    from industry_analysis.queue.scorer import score as compute_score
    inbox = qs.list(status="inbox")
    for t in inbox:
        t.priority_score = compute_score(t, existing)
        qs.update_score(t.id, t.priority_score)

    task = qs.next_task()
    if task is None:
        # Try inbox if no queued
        task = qs.next_task(status="inbox")
    if task is None:
        typer.echo("Queue empty.")
        return
    if json:
        _emit(task.__dict__, True)
    else:
        typer.echo(f"Next task: [{task.id}] score={task.priority_score} ({interpret(task.priority_score)})")
        typer.echo(f"  Signal: {task.trigger_summary}")
        typer.echo(f"  Node:   {task.root_node}")
        typer.echo(f"  Why:    {task.why_now or '(not specified)'}")
        typer.echo(f"\nRun: ia expand {task.root_node.lower().replace(' ', '')}")
        typer.echo(f"Then: ia queue done {task.id}")


@queue_app.command("done")
def queue_done(task_id: str):
    """Mark a queue task as done after expanding."""
    from industry_analysis.queue.models import _now
    _qstore().update_status(task_id, "done", expanded_at=_now())
    typer.echo(f"done {task_id}")


@queue_app.command("score")
def queue_score(task_id: str, json: bool = False):
    """(Re)compute priority score for a task."""
    from industry_analysis.queue.scorer import score as compute_score, interpret
    qs = _qstore()
    task = qs.get(task_id)
    if not task:
        typer.echo(f"task {task_id} not found", err=True); return
    existing = {n.id for n in _store().list_nodes()}
    s = compute_score(task, existing)
    qs.update_score(task_id, s)
    if json:
        _emit({"id": task_id, "score": s, "interpretation": interpret(s)}, True)
    else:
        typer.echo(f"{task_id}: {s} → {interpret(s)}")


@queue_app.command("expire")
def queue_expire():
    """Move TTL-expired inbox tasks to 'monitor' status."""
    n = _qstore().expire_stale()
    typer.echo(f"expired {n} stale tasks → monitor")


# ── ia news ─────────────────────────────────────────────────────────────────

@news_app.command("scan")
def news_scan(
    cn: bool = typer.Option(True, "--cn/--no-cn", help="Fetch CN news (GDELT + East Money)"),
    us: bool = typer.Option(True, "--us/--no-us", help="Fetch US news (GDELT + yfinance)"),
    since: int = typer.Option(24, "--since", help="Lookback window in hours"),
    themes: Optional[str] = typer.Option(None, "--themes", help="Comma-separated theme keys"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print signals, don't queue"),
    json: bool = False,
):
    """Scan real-time news and extract supply-chain mining signals into the queue."""
    from industry_analysis.news.fetchers.gdelt import fetch_supply_chain_news
    from industry_analysis.news.fetchers.eastmoney import fetch_flash_news, fetch_announcements
    from industry_analysis.news.fetchers.yfinance_news import fetch as fetch_yf
    from industry_analysis.news.scanner import scan
    from industry_analysis.queue.scorer import score as compute_score
    from industry_analysis.queue.store import QueueStore

    theme_list = themes.split(",") if themes else None
    timespan = f"{since}h" if since <= 48 else f"{since // 24}d"
    articles = []

    if cn:
        typer.echo(f"Fetching CN news (GDELT {timespan} + East Money)...")
        articles += fetch_supply_chain_news(theme_list, timespan=timespan, max_per_query=10)
        articles += fetch_flash_news(since_hours=since, max_records=20)
        articles += fetch_announcements()

    if us:
        typer.echo(f"Fetching US news (GDELT {timespan} + yfinance)...")
        articles += fetch_supply_chain_news(theme_list, timespan=timespan, max_per_query=10)
        articles += fetch_yf(max_per_ticker=3)

    typer.echo(f"Fetched {len(articles)} articles. Scanning for signals...")

    if not articles:
        typer.echo("No articles fetched.")
        return

    client = _client()
    result = scan(articles, client, source_label=f"news_scan_{'cn' if cn else ''}{'us' if us else ''}")

    typer.echo(f"Found {len(result.tasks)} signals from {result.articles_scanned} articles ({result.batches_run} batches)")

    if result.errors:
        for e in result.errors:
            typer.echo(f"  WARN: {e}", err=True)

    if not result.tasks:
        typer.echo("No actionable signals found.")
        return

    if dry_run:
        for t in result.tasks:
            typer.echo(f"  [DRY] score={t.priority_score} | {t.trigger_summary[:60]} → {t.root_node}")
        return

    # Add to queue — keep QuantAgent's score if already set (>0),
    # only use our scorer to boost graph_gap dimension for new nodes
    qs = QueueStore(get_settings().resolved_db_path())
    existing = {n.id for n in _store().list_nodes()}
    added = 0
    for task in result.tasks:
        if task.priority_score <= 0:
            task.priority_score = compute_score(task, existing)
        else:
            # Boost by graph_gap: +5 if node is genuinely new to our DAG
            from industry_analysis.graph.models import normalize
            if normalize(task.root_node) not in existing:
                task.priority_score = min(100, task.priority_score + 5)
        qs.add(task)
        added += 1

    if json:
        _emit({"added": added, "tasks": [t.__dict__ for t in result.tasks]}, True)
    else:
        typer.echo(f"\nAdded {added} tasks to queue. Run `ia queue list` to see them.")
        typer.echo("Run `ia queue next` to get the highest-priority task.")


if __name__ == "__main__":
    app()
