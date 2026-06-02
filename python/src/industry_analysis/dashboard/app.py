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

    return app


app = create_app()
