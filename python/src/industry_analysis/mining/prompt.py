from industry_analysis.graph.models import Node

_SCHEMA = '''Return ONLY a JSON object: {"children": [ {
  "name_cn": str, "name_en": str, "aliases": [str],
  "node_type": "sub_industry|module|component|material|precursor|equipment",
  "bottleneck_layer": "技术物理层|工艺设备层|材料前驱体层|量产生态层|资本市场层" or null,
  "description": str, "evidence_grade": "A|B|C|D|E", "relation_rationale": str,
  "sources": ["E1", "E2"]
} ] }'''

_METHOD = (
    "沿『下游→上游』按瓶颈五层下钻：技术物理层 / 工艺设备层 / 材料前驱体层 / 量产生态层 / 资本市场层。"
    "只挖出该节点的直接上游环节（不要跳层、不要直接给公司）。"
    "用 A–E 证据分级标注每个候选（A=监管/财报/客户官方，E=无源待核验）。"
    "为可能跨主题复用的关键环节给出 aliases（中英文/化学式/代号），便于去重。"
)

_EVIDENCE_INSTRUCTION = (
    "如果上方 <evidence> 中有与候选节点相关的证据片段，"
    "在该候选的 sources 字段中引用对应的证据 ID（如 [\"E1\", \"E3\"]）。"
    "sources 只能引用上方提供的证据 ID，不可自行编造。"
    "若无相关证据，sources 留空 []，并据实填写 evidence_grade。"
)


def build_expand_prompt(
    node: Node,
    parent_chain: list[Node],
    existing_children: list[str],
    evidence_block: str = "",
) -> str:
    chain = " → ".join(f"{n.name_cn}({n.name_en})" for n in reversed(parent_chain))
    existing = "、".join(existing_children) if existing_children else "（无）"

    evidence_section = ""
    if evidence_block:
        evidence_section = (
            f"\n<evidence>\n{evidence_block}\n</evidence>\n\n"
            f"{_EVIDENCE_INSTRUCTION}\n"
        )

    return (
        f"你是产业链瓶颈挖掘分析师。当前节点：{node.name_cn} / {node.name_en}"
        f"（类型 {node.node_type.value}）。\n"
        f"下游路径：{chain}\n"
        f"该节点已知的直接上游（请勿重复）：{existing}\n"
        f"{evidence_section}\n"
        f"方法论：{_METHOD}\n\n"
        f"{_SCHEMA}"
    )
