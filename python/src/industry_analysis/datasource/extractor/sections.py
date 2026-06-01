import re
from ..models import SectionRecord

_CN_H1 = re.compile(r'^第[一二三四五六七八九十百]+[节章]\s*(.{1,30})', re.MULTILINE)
_CN_H2 = re.compile(r'^[一二三四五六七八九十]+[、．.]\s*(.{1,30})', re.MULTILINE)
_CN_H3 = re.compile(r'^（[一二三四五六七八九十]+）\s*(.{1,30})', re.MULTILINE)


def parse_sections_cn(text: str, document_id: str, symbol: str) -> list[SectionRecord]:
    """Split CN annual report / prospectus text into sections by heading patterns."""
    boundaries: list[tuple[int, int, str]] = []
    for m in _CN_H1.finditer(text):
        boundaries.append((m.start(), 1, m.group(0).strip()))
    for m in _CN_H2.finditer(text):
        boundaries.append((m.start(), 2, m.group(0).strip()))
    for m in _CN_H3.finditer(text):
        boundaries.append((m.start(), 3, m.group(0).strip()))
    boundaries.sort(key=lambda x: x[0])

    if not boundaries:
        return [SectionRecord(
            document_id=document_id, symbol=symbol,
            section_seq=0, section_level=1,
            heading_path="(全文)", section_name="(全文)",
            content=text.strip(),
        )]

    sections: list[SectionRecord] = []
    path_stack: list[str] = []

    for i, (pos, level, name) in enumerate(boundaries):
        end = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(text)
        content = text[pos:end].strip()
        while len(path_stack) >= level:
            path_stack.pop()
        path_stack.append(name)
        sections.append(SectionRecord(
            document_id=document_id, symbol=symbol,
            section_seq=i, section_level=level,
            heading_path="/".join(path_stack), section_name=name,
            content=content,
        ))
    return sections
