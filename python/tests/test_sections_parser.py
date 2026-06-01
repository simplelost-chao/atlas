from industry_analysis.datasource.extractor.sections import parse_sections_cn

CN_TEXT = """第三节 公司业务

一、主营业务

公司主要从事半导体芯片设计，产品包括功率管理芯片。

（一）主要供应商

前五大供应商如下：
1. 台积电（TSMC）：晶圆代工，占采购金额30%
2. 某未上市材料有限公司：占采购金额15%

二、主要客户

公司前三大客户为AI服务器厂商。
"""


def test_returns_non_empty():
    secs = parse_sections_cn(CN_TEXT, document_id="d", symbol="688036.SH")
    assert len(secs) > 0


def test_all_fields_set():
    secs = parse_sections_cn(CN_TEXT, document_id="d", symbol="688036.SH")
    for s in secs:
        assert s.document_id == "d"
        assert s.symbol == "688036.SH"
        assert len(s.content) > 0


def test_detects_supplier_section():
    secs = parse_sections_cn(CN_TEXT, document_id="d", symbol="s")
    headings = [s.heading_path for s in secs]
    assert any("供应商" in h for h in headings)


def test_detects_customer_section():
    secs = parse_sections_cn(CN_TEXT, document_id="d", symbol="s")
    headings = [s.heading_path for s in secs]
    assert any("客户" in h for h in headings)


def test_section_seq_increments():
    secs = parse_sections_cn(CN_TEXT, document_id="d", symbol="s")
    seqs = [s.section_seq for s in secs]
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == len(seqs)
