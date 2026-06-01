from industry_analysis.datasource.extractor.mentions import extract_mentions
from industry_analysis.datasource.models import SectionRecord


def _sec(heading: str, content: str, symbol="688036.SH") -> SectionRecord:
    return SectionRecord(document_id="d", symbol=symbol, section_seq=0,
                         section_level=2, heading_path=heading,
                         section_name=heading, content=content)


def test_supplier_full_name():
    sec = _sec("第三节/主要供应商",
               "前五大供应商：台积电（TSMC）占30%，某未上市材料有限公司占15%")
    candidates = extract_mentions([sec])
    assert any(c.mention_type == "supplier" for c in candidates)
    assert any("有限公司" in c.mentioned_name for c in candidates)


def test_match_type_full_name():
    sec = _sec("第三节/主要供应商", "供应商包括绿的谐波技术有限公司，占采购金额20%")
    candidates = extract_mentions([sec])
    assert any(c.match_type == "full_name" for c in candidates)


def test_customer_section():
    sec = _sec("第三节/主要客户",
               "主要客户：华为技术有限公司（20%），中兴通讯股份有限公司（15%）")
    candidates = extract_mentions([sec])
    assert all(c.mention_type == "customer" for c in candidates)
    assert len(candidates) >= 1


def test_context_included():
    sec = _sec("第三节/主要供应商",
               "主要供应商为绿的谐波技术有限公司，供应谐波减速器，占采购金额25%")
    candidates = extract_mentions([sec])
    assert any("谐波" in c.context for c in candidates)


def test_irrelevant_section_empty():
    sec = _sec("第一节/重要提示", "本报告不构成投资建议，请谨慎阅读。")
    assert extract_mentions([sec]) == []
