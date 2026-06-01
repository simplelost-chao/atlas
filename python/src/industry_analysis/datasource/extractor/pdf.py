from dataclasses import dataclass
from io import BytesIO


@dataclass
class ExtractionResult:
    text: str
    status: str   # success / failed_corrupt / failed_ocr
    char_count: int = 0

    def __post_init__(self):
        if not self.char_count:
            self.char_count = len(self.text)


def extract_text_from_pdf(data: bytes) -> ExtractionResult:
    """Extract plain text from PDF bytes.

    Status meanings:
      success       — text extracted successfully
      failed_corrupt — not a valid PDF or parse error
      failed_ocr    — valid PDF but no text layer (scanned image)
    """
    if not data or not data.strip().startswith(b"%PDF"):
        return ExtractionResult(text="", status="failed_corrupt")
    try:
        from pdfminer.high_level import extract_text
        text = extract_text(BytesIO(data)) or ""
        text = text.strip()
        if not text:
            return ExtractionResult(text="", status="failed_ocr")
        return ExtractionResult(text=text, status="success")
    except Exception:
        return ExtractionResult(text="", status="failed_corrupt")
