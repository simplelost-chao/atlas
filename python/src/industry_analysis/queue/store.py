"""SQLite persistence for the mining task queue.

Uses the same graph.db file as GraphStore to keep things self-contained.
The mining_queue table is completely separate from the DAG tables.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

from .models import MiningTask, _now

_SCHEMA = """
CREATE TABLE IF NOT EXISTS mining_queue (
    id                  TEXT PRIMARY KEY,
    driver_type         TEXT NOT NULL,
    trigger_summary     TEXT NOT NULL,
    root_node           TEXT NOT NULL,
    source              TEXT DEFAULT '',
    source_grade        TEXT DEFAULT 'D',
    why_now             TEXT DEFAULT '',
    initial_hypothesis  TEXT DEFAULT '',
    suggested_expands   TEXT DEFAULT '[]',
    expected_layers     TEXT DEFAULT '[]',
    falsification       TEXT DEFAULT '',
    ttl_days            INTEGER DEFAULT 7,
    priority_score      INTEGER DEFAULT 0,
    status              TEXT DEFAULT 'inbox',
    signal_date         TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    expanded_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_mq_status    ON mining_queue(status);
CREATE INDEX IF NOT EXISTS idx_mq_priority  ON mining_queue(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_mq_node      ON mining_queue(root_node);
"""


class QueueStore:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._conn()) as conn:
            conn.executescript(_SCHEMA)
            conn.commit()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def add(self, task: MiningTask) -> MiningTask:
        if not task.id:
            task.id = str(uuid.uuid4())[:8]
        with closing(self._conn()) as conn:
            conn.execute(
                """INSERT OR REPLACE INTO mining_queue VALUES
                   (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    task.id, task.driver_type, task.trigger_summary, task.root_node,
                    task.source, task.source_grade, task.why_now, task.initial_hypothesis,
                    json.dumps(task.suggested_expands, ensure_ascii=False),
                    json.dumps(task.expected_layers, ensure_ascii=False),
                    task.falsification, task.ttl_days, task.priority_score,
                    task.status, task.signal_date, task.created_at, task.updated_at,
                    task.expanded_at,
                ),
            )
            conn.commit()
        return task

    def get(self, task_id: str) -> MiningTask | None:
        with closing(self._conn()) as conn:
            row = conn.execute("SELECT * FROM mining_queue WHERE id=?", (task_id,)).fetchone()
        return _from_row(row) if row else None

    def list(
        self,
        status: str | None = None,
        driver_type: str | None = None,
        min_score: int = 0,
        limit: int = 50,
    ) -> list[MiningTask]:
        q = "SELECT * FROM mining_queue WHERE priority_score >= ?"
        params: list = [min_score]
        if status:
            q += " AND status=?"; params.append(status)
        if driver_type:
            q += " AND driver_type=?"; params.append(driver_type)
        q += " ORDER BY priority_score DESC, created_at ASC LIMIT ?"
        params.append(limit)
        with closing(self._conn()) as conn:
            rows = conn.execute(q, params).fetchall()
        return [_from_row(r) for r in rows]

    def update_status(self, task_id: str, status: str, expanded_at: str | None = None):
        with closing(self._conn()) as conn:
            conn.execute(
                "UPDATE mining_queue SET status=?, updated_at=?, expanded_at=COALESCE(?,expanded_at) WHERE id=?",
                (status, _now(), expanded_at, task_id),
            )
            conn.commit()

    def update_score(self, task_id: str, score: int):
        with closing(self._conn()) as conn:
            conn.execute(
                "UPDATE mining_queue SET priority_score=?, updated_at=?, status='queued' WHERE id=? AND status='inbox'",
                (score, _now(), task_id),
            )
            conn.commit()

    def next_task(self, status: str = "queued") -> MiningTask | None:
        """Return the highest-priority task ready to expand."""
        with closing(self._conn()) as conn:
            row = conn.execute(
                "SELECT * FROM mining_queue WHERE status=? ORDER BY priority_score DESC LIMIT 1",
                (status,),
            ).fetchone()
        return _from_row(row) if row else None

    def expire_stale(self) -> int:
        """Move inbox tasks past their TTL to 'monitor' status."""
        tasks = self.list(status="inbox")
        expired = [t for t in tasks if t.is_expired]
        for t in expired:
            self.update_status(t.id, "monitor")
        return len(expired)


def _from_row(r: sqlite3.Row) -> MiningTask:
    return MiningTask(
        id=r["id"], driver_type=r["driver_type"],
        trigger_summary=r["trigger_summary"], root_node=r["root_node"],
        source=r["source"] or "", source_grade=r["source_grade"] or "D",
        why_now=r["why_now"] or "", initial_hypothesis=r["initial_hypothesis"] or "",
        suggested_expands=json.loads(r["suggested_expands"] or "[]"),
        expected_layers=json.loads(r["expected_layers"] or "[]"),
        falsification=r["falsification"] or "",
        ttl_days=r["ttl_days"] or 7,
        priority_score=r["priority_score"] or 0,
        status=r["status"] or "inbox",
        signal_date=r["signal_date"], created_at=r["created_at"],
        updated_at=r["updated_at"], expanded_at=r["expanded_at"],
    )
