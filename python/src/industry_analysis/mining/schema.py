import json
import re
from pydantic import BaseModel, Field, ValidationError


class ParseError(Exception):
    pass


class CandidateChild(BaseModel):
    name_cn: str
    name_en: str
    aliases: list[str] = Field(default_factory=list)
    node_type: str
    bottleneck_layer: str | None = None
    description: str = ""
    evidence_grade: str | None = None
    relation_rationale: str = ""
    sources: list[str] = Field(default_factory=list)


class CandidateBatch(BaseModel):
    children: list[CandidateChild] = Field(default_factory=list)


def _extract_json(raw: str) -> str:
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if fence:
        return fence.group(1)
    brace = re.search(r"\{.*\}", raw, re.DOTALL)
    if brace:
        return brace.group(0)
    raise ParseError("no JSON object found in agent output")


def parse_candidates(raw: str) -> CandidateBatch:
    try:
        return CandidateBatch.model_validate(json.loads(_extract_json(raw)))
    except (json.JSONDecodeError, ValidationError) as e:
        raise ParseError(str(e)) from e
