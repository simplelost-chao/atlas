import pytest
from industry_analysis.mining.schema import parse_candidates, ParseError

def test_parses_fenced_json():
    raw = '```json\n{"children":[{"name_cn":"芯片","name_en":"Chip","node_type":"sub_industry","description":"d"}]}\n```'
    batch = parse_candidates(raw)
    assert batch.children[0].name_en == "Chip"
    assert batch.children[0].aliases == []

def test_bad_json_raises():
    with pytest.raises(ParseError):
        parse_candidates("not json at all")
