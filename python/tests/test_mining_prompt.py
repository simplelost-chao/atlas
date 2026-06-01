from industry_analysis.mining.prompt import build_expand_prompt
from industry_analysis.graph.models import Node, NodeType

def test_prompt_includes_context_and_schema():
    node = Node(id="ai", name_cn="AI基础设施", name_en="AI Infra", node_type=NodeType.theme,
                theme_ids=["ai"], description="AI 算力")
    p = build_expand_prompt(node, parent_chain=[node], existing_children=["芯片"])
    assert "AI基础设施" in p
    assert "芯片" in p            # tells agent what already exists (avoid dup)
    assert "children" in p        # output schema mentioned
    assert "技术物理层" in p      # methodology layers injected
