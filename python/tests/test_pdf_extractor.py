from industry_analysis.datasource.extractor.pdf import extract_text_from_pdf, ExtractionResult


def test_empty_bytes_returns_failed():
    r = extract_text_from_pdf(b"")
    assert r.text == ""
    assert r.status == "failed_corrupt"


def test_non_pdf_returns_failed():
    r = extract_text_from_pdf(b"not a pdf at all")
    assert r.status == "failed_corrupt"
    assert r.text == ""


def test_returns_extraction_result():
    r = extract_text_from_pdf(b"%PDF-1.4 minimal")
    assert hasattr(r, "text")
    assert hasattr(r, "status")
    assert r.status in ("success", "failed_corrupt", "failed_ocr")
