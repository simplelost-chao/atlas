import re
from ..models import MentionCandidate, SectionRecord

_SUPPLIER_KW = ["供应商", "采购", "Supply Chain", "Supplier", "Suppliers", "Vendor"]
_CUSTOMER_KW = ["客户", "销售", "Customer", "Customers", "Client"]
_COMPETITOR_KW = ["竞争", "同行", "Competition", "Competitor"]

_CN_FULL = re.compile(
    r'[一-鿿]{2,20}'
    r'(?:有限公司|股份有限公司|有限责任公司|集团有限公司|科技有限公司|'
    r'技术有限公司|材料有限公司|电子有限公司|半导体有限公司|集团股份有限公司)'
)
_EN_FULL = re.compile(
    r'\b[A-Z][A-Za-z\s\-&,\.]{2,40}'
    r'(?:Inc\.|Corp\.|LLC|Ltd\.|Co\.,?\s*Ltd|Corporation|Company|'
    r'Technologies|Systems|Semiconductor|Technology|Holdings|Group)\b'
)
_EN_KNOWN = re.compile(
    r'\b(?:TSMC|ASML|NVIDIA|AMD|Intel|Samsung|Micron|Broadcom|Marvell|'
    r'Qualcomm|Applied Materials|Lam Research)\b'
)

_CONTEXT_WINDOW = 200


def _classify(heading_path: str) -> str | None:
    hp = heading_path.lower()
    if any(k.lower() in hp for k in _SUPPLIER_KW):
        return "supplier"
    if any(k.lower() in hp for k in _CUSTOMER_KW):
        return "customer"
    if any(k.lower() in hp for k in _COMPETITOR_KW):
        return "competitor"
    return None


def extract_mentions(sections: list[SectionRecord]) -> list[MentionCandidate]:
    """Extract company mention candidates from supplier/customer/competitor sections.

    Returns MentionCandidate list. These are CANDIDATES, not verified facts.
    match_type: full_name (high conf) vs short_name (medium conf).
    """
    results: list[MentionCandidate] = []
    for sec in sections:
        mention_type = _classify(sec.heading_path)
        if mention_type is None:
            continue
        text = sec.content
        seen: set[str] = set()
        for pat, mtype in ((_CN_FULL, "full_name"), (_EN_FULL, "full_name"),
                           (_EN_KNOWN, "short_name")):
            for m in pat.finditer(text):
                name = m.group(0).strip()
                if name in seen or len(name) < 2:
                    continue
                seen.add(name)
                cs = max(0, m.start() - _CONTEXT_WINDOW // 2)
                ce = min(len(text), m.end() + _CONTEXT_WINDOW // 2)
                results.append(MentionCandidate(
                    mentioned_name=name, mention_type=mention_type,
                    context=text[cs:ce].strip(),
                    section_path=sec.heading_path,
                    match_type=mtype,
                    confidence=0.9 if mtype == "full_name" else 0.6,
                ))
    return results
