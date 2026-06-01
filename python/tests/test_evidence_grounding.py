"""PR2: Tests for filing evidence grounding in expand prompt."""
import json
import pytest
from industry_analysis.mining.evidence_context import (
    Evidence, gather_evidence, format_evidence_block,
)
from industry_analysis.mining.prompt import build_expand_prompt
from industry_analysis.mining.schema import parse_candidates
from industry_analysis.graph.models import Node, NodeType


# ── Fake datasource ───────────────────────────────────────────────────────────

class _SearchResult:
    def __init__(self, filer_name, section_path, snippet):
        self.filer_name = filer_name
        self.section_path = section_path
        self.snippet = snippet


class FakeDatasourceDB:
    def __init__(self, results: list[_SearchResult]):
        self._results = results

    def search(self, keyword: str, limit: int = 20) -> list[_SearchResult]:
        return self._results[:limit]


# ── gather_evidence ───────────────────────────────────────────────────────────

class TestGatherEvidence:
    def test_returns_empty_without_datasource(self):
        assert gather_evidence(["InP"], None) == []

    def test_deduplicates_by_filer_and_section(self):
        db = FakeDatasourceDB([
            _SearchResult("AXTI", "Business", "InP substrate..."),
            _SearchResult("AXTI", "Business", "duplicate entry"),  # same filer+section
            _SearchResult("IQE plc", "Risk Factors", "InP demand..."),
        ])
        ev = gather_evidence(["InP", "磷化铟"], db, limit_per_alias=3)
        # Should deduplicate AXTI/Business
        filer_sections = [(e.filer_name, e.section_path) for e in ev]
        assert len(filer_sections) == len(set(filer_sections))

    def test_assigns_sequential_ids(self):
        db = FakeDatasourceDB([
            _SearchResult("A", "s1", "snippet1"),
            _SearchResult("B", "s2", "snippet2"),
        ])
        ev = gather_evidence(["test"], db)
        assert [e.id for e in ev] == ["E1", "E2"]

    def test_skips_short_names(self):
        db = FakeDatasourceDB([_SearchResult("X", "s", "snippet")])
        ev = gather_evidence(["A", "InP"], db)  # "A" is < 2 chars, skipped
        # Only "InP" search runs
        assert len(ev) <= 1

    def test_respects_max_total(self):
        db = FakeDatasourceDB([
            _SearchResult(f"co{i}", f"s{i}", f"snip{i}") for i in range(20)
        ])
        ev = gather_evidence(["term1", "term2"], db, limit_per_alias=10, max_total=5)
        assert len(ev) <= 5


# ── format_evidence_block ────────────────────────────────────────────────────

class TestFormatEvidenceBlock:
    def test_empty_list_returns_empty_string(self):
        assert format_evidence_block([]) == ""

    def test_includes_id_filer_section_snippet(self):
        ev = [Evidence("E1", "AXTI", "Business", "InP substrate supplier...")]
        block = format_evidence_block(ev)
        assert "[E1]" in block
        assert "AXTI" in block
        assert "Business" in block
        assert "InP substrate" in block


# ── build_expand_prompt with evidence ────────────────────────────────────────

class TestExpandPromptWithEvidence:
    def _node(self):
        return Node(
            id="inp-substrate", name_cn="磷化铟衬底", name_en="InP Substrate",
            node_type=NodeType.material,
        )

    def test_prompt_without_evidence_has_no_evidence_tag(self):
        node = self._node()
        prompt = build_expand_prompt(node, [node], [], evidence_block="")
        assert "<evidence>" not in prompt

    def test_prompt_with_evidence_includes_block(self):
        node = self._node()
        block = "[E1] 来源: AXTI | 章节: Business\n    InP substrate supplier..."
        prompt = build_expand_prompt(node, [node], [], evidence_block=block)
        assert "<evidence>" in prompt
        assert "[E1]" in prompt
        assert "AXTI" in prompt

    def test_prompt_with_evidence_includes_citation_instruction(self):
        node = self._node()
        block = "[E1] 来源: AXTI | 章节: Business\n    test"
        prompt = build_expand_prompt(node, [node], [], evidence_block=block)
        assert "sources" in prompt.lower()


# ── parse_candidates with evidence validation ────────────────────────────────

class TestParseCandidatesValidation:
    def _raw(self, sources: list[str], grade: str = "A") -> str:
        return json.dumps({"children": [{
            "name_cn": "测试节点", "name_en": "TestNode", "aliases": [],
            "node_type": "component", "bottleneck_layer": None,
            "description": "test", "evidence_grade": grade,
            "relation_rationale": "test", "sources": sources,
        }]})

    def test_valid_evidence_id_is_kept(self):
        raw = self._raw(["E1", "E2"])
        batch = parse_candidates(raw, valid_evidence_ids={"E1", "E2"})
        assert batch.children[0].sources == ["E1", "E2"]

    def test_unknown_evidence_id_is_stripped(self):
        raw = self._raw(["E1", "E99"])
        batch = parse_candidates(raw, valid_evidence_ids={"E1"})
        assert batch.children[0].sources == ["E1"]

    def test_no_valid_citation_downgrades_ab_grade(self):
        raw = self._raw(["E99"], grade="A")
        batch = parse_candidates(raw, valid_evidence_ids={"E1"})
        assert batch.children[0].evidence_grade == "E"
        assert batch.children[0].sources == []

    def test_no_valid_citation_keeps_lower_grades(self):
        # D/E are already low, no need to further downgrade
        raw = self._raw(["E99"], grade="D")
        batch = parse_candidates(raw, valid_evidence_ids={"E1"})
        assert batch.children[0].evidence_grade == "D"

    def test_empty_sources_without_evidence_ids_unchanged(self):
        # When no evidence was injected, validation doesn't run
        raw = self._raw([], grade="A")
        batch = parse_candidates(raw, valid_evidence_ids=None)
        assert batch.children[0].evidence_grade == "A"

    def test_backward_compat_no_valid_ids_arg(self):
        raw = self._raw(["some-source"], grade="B")
        batch = parse_candidates(raw)  # no valid_evidence_ids arg
        assert batch.children[0].evidence_grade == "B"
