import re
from datetime import datetime, timezone
from enum import Enum
from pydantic import BaseModel, Field


class NodeType(str, Enum):
    theme = "theme"
    sub_industry = "sub_industry"
    module = "module"
    component = "component"
    material = "material"
    precursor = "precursor"
    equipment = "equipment"
    company = "company"


class BottleneckLayer(str, Enum):
    physical = "技术物理层"
    process_equipment = "工艺设备层"
    material_precursor = "材料前驱体层"
    mass_production = "量产生态层"
    capital_market = "资本市场层"


class NodeStatus(str, Enum):
    proposed = "proposed"
    confirmed = "confirmed"
    rejected = "rejected"


class EvidenceGrade(str, Enum):
    A = "A"; B = "B"; C = "C"; D = "D"; E = "E"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize(name: str) -> str:
    """Lowercase, drop all non-alphanumeric (incl. spaces) for alias matching. Keeps CJK."""
    return re.sub(r"[^0-9a-z一-鿿]", "", name.lower())


class Node(BaseModel):
    id: str
    name_cn: str
    name_en: str
    aliases: list[str] = Field(default_factory=list)
    node_type: NodeType
    bottleneck_layer: BottleneckLayer | None = None
    theme_ids: list[str] = Field(default_factory=list)
    description: str = ""
    status: NodeStatus = NodeStatus.proposed
    evidence_grade: EvidenceGrade | None = None
    evidence_md: str = ""
    metadata: dict = Field(default_factory=dict)
    created_at: str = Field(default_factory=_now)
    updated_at: str = Field(default_factory=_now)

    def all_names(self) -> list[str]:
        return [self.name_cn, self.name_en, *self.aliases]


class Edge(BaseModel):
    upstream_id: str
    downstream_id: str
    relation: str = "upstream_of"
    rationale: str = ""
