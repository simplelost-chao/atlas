"""Mining task queue models.

A MiningTask represents one supply-chain signal that needs to be expanded.
Lifecycle: inbox → queued → expanding → done (or rejected / monitor).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


DRIVER_TYPES = ("news", "anticipation", "structural")
STATUSES = ("inbox", "queued", "expanding", "done", "rejected", "monitor")


@dataclass
class MiningTask:
    id: str
    driver_type: str           # news | anticipation | structural
    trigger_summary: str       # one-line description of the signal
    root_node: str             # which graph node to expand (or create)

    source: str = ""           # e.g. "gdelt", "eastmoney", "manual"
    source_grade: str = "D"    # A-E evidence grade of the triggering source
    why_now: str = ""
    initial_hypothesis: str = ""
    suggested_expands: list[str] = field(default_factory=list)
    expected_layers: list[str] = field(default_factory=list)
    falsification: str = ""

    ttl_days: int = 7
    priority_score: int = 0
    status: str = "inbox"

    signal_date: str = field(default_factory=_now)
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    expanded_at: Optional[str] = None

    @property
    def ttl_expires(self) -> str:
        base = datetime.fromisoformat(self.signal_date.replace("Z", "+00:00"))
        return (base + timedelta(days=self.ttl_days)).isoformat()

    @property
    def is_expired(self) -> bool:
        try:
            exp = datetime.fromisoformat(self.ttl_expires.replace("Z", "+00:00"))
            return datetime.now(timezone.utc) > exp
        except Exception:
            return False
