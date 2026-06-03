import pytest
from fastapi.testclient import TestClient
from pathlib import Path
from industry_analysis.dashboard.app import create_app
from industry_analysis.queue.store import QueueStore
from industry_analysis.queue.models import MiningTask, _now


@pytest.fixture
def client(tmp_path):
    app = create_app(db_path=str(tmp_path / "graph.db"))
    return TestClient(app)


@pytest.fixture
def client_with_task(tmp_path):
    db = tmp_path / "graph.db"
    qs = QueueStore(db)
    task = MiningTask(
        id="abc12345", driver_type="news",
        trigger_summary="MLCC缺货信号",
        root_node="mlcc", priority_score=75, status="queued",
        signal_date=_now(), created_at=_now(), updated_at=_now(),
    )
    qs.add(task)
    app = create_app(db_path=str(db))
    return TestClient(app), task.id


def test_get_queue_returns_list(client):
    resp = client.get("/api/queue")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_get_queue_with_status_filter(client_with_task):
    c, _ = client_with_task
    resp = c.get("/api/queue?status=queued")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert all(t["status"] == "queued" for t in data)


def test_post_queue_adds_task(client):
    payload = {
        "driver_type": "news",
        "trigger_summary": "碳化硅扩产信号",
        "root_node": "distributed-energy",
        "source_grade": "C",
    }
    resp = client.post("/api/queue", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["root_node"] == "distributed-energy"
    assert "id" in data


def test_patch_queue_updates_status(client_with_task):
    c, task_id = client_with_task
    resp = c.patch(f"/api/queue/{task_id}", json={"status": "done"})
    assert resp.status_code == 200
    resp2 = c.get(f"/api/queue/{task_id}")
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "done"


def test_delete_queue_removes_task(client_with_task):
    c, task_id = client_with_task
    resp = c.delete(f"/api/queue/{task_id}")
    assert resp.status_code == 200
    resp2 = c.get(f"/api/queue/{task_id}")
    assert resp2.status_code == 404


def test_get_queue_single_task(client_with_task):
    c, task_id = client_with_task
    resp = c.get(f"/api/queue/{task_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == task_id
