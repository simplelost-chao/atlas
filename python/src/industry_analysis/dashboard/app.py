from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from industry_analysis.config import get_settings
from industry_analysis.graph.store import GraphStore
from industry_analysis.review import queue

_STATIC = Path(__file__).parent / "static"


def create_app(db_path=None) -> FastAPI:
    db = db_path or get_settings().resolved_db_path()
    app = FastAPI(title="IndustryAnalysis")

    def store():
        return GraphStore(db)

    @app.get("/")
    def index():
        return FileResponse(_STATIC / "index.html")

    @app.get("/api/graph")
    def graph():
        return store().export()

    @app.get("/api/node/{node_id}")
    def node(node_id: str):
        n = store().get_node(node_id)
        if not n:
            raise HTTPException(404, "node not found")
        return n.model_dump(mode="json")

    @app.get("/api/chokepoints")
    def chokepoints(min_themes: int = 2):
        return [n.model_dump(mode="json") for n in store().chokepoints(min_themes)]

    @app.get("/api/review")
    def review():
        return [n.model_dump(mode="json") for n in queue.pending(store())]

    @app.post("/api/review/{node_id}")
    def review_act(node_id: str, action: str):
        s = store()
        if action == "approve":
            queue.approve(s, node_id)
        elif action == "reject":
            queue.reject(s, node_id)
        else:
            raise HTTPException(400, "action must be approve|reject")
        return {"ok": True}

    # ── Queue management ────────────────────────────────────────────
    from industry_analysis.queue.store import QueueStore as _QueueStore
    from industry_analysis.queue.models import MiningTask as _MiningTask, _now as _queue_now
    import dataclasses as _dc
    import sqlite3 as _sqlite3
    from contextlib import closing as _closing

    def _queue_store():
        return _QueueStore(db)

    @app.get("/api/queue")
    def queue_list(status: str | None = None, min_score: int = 0,
                   limit: int = 50):
        return [_dc.asdict(t) for t in _queue_store().list(
            status=status, min_score=min_score, limit=limit)]

    @app.get("/api/queue/{task_id}")
    def queue_get(task_id: str):
        t = _queue_store().get(task_id)
        if not t:
            raise HTTPException(status_code=404, detail="task not found")
        return _dc.asdict(t)

    @app.post("/api/queue")
    def queue_add(body: dict):
        qs = _queue_store()
        task = _MiningTask(
            id="",
            driver_type=body.get("driver_type", "news"),
            trigger_summary=body.get("trigger_summary", ""),
            root_node=body.get("root_node", ""),
            source=body.get("source", "manual"),
            source_grade=body.get("source_grade", "D"),
            why_now=body.get("why_now", ""),
            signal_date=_queue_now(), created_at=_queue_now(), updated_at=_queue_now(),
        )
        added = qs.add(task)
        return _dc.asdict(added)

    @app.patch("/api/queue/{task_id}")
    def queue_update(task_id: str, body: dict):
        qs = _queue_store()
        if not qs.get(task_id):
            raise HTTPException(status_code=404, detail="task not found")
        new_status = body.get("status")
        if new_status:
            valid = {"inbox", "queued", "expanding", "done", "rejected", "monitor"}
            if new_status not in valid:
                raise HTTPException(status_code=400, detail=f"invalid status: {new_status}")
            qs.update_status(task_id, new_status)
        return {"ok": True}

    @app.delete("/api/queue/{task_id}")
    def queue_delete(task_id: str):
        qs = _queue_store()
        if not qs.get(task_id):
            raise HTTPException(status_code=404, detail="task not found")
        with _closing(_sqlite3.connect(str(db))) as conn:
            conn.execute("DELETE FROM mining_queue WHERE id=?", (task_id,))
            conn.commit()
        return {"ok": True}

    @app.get("/queue")
    def queue_page():
        return FileResponse(_STATIC / "queue.html")

    return app


app = create_app()
