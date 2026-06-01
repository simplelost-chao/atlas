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
app.add_typer(theme_app, name="theme")
app.add_typer(node_app, name="node")
app.add_typer(review_app, name="review")


def _store() -> GraphStore:
    return GraphStore(get_settings().db_path)


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
    if cfg.datasource_db_path and cfg.datasource_db_path.exists():
        return DataSourceDB(cfg.datasource_db_path)
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


if __name__ == "__main__":
    app()
