import type { PipelineStep } from "./llm-router";

/**
 * System prompt shared across all pipeline steps.
 */
const SYSTEM_PROMPT = `你是一位资深产业分析师和投资研究专家。你的任务是对产业链进行深入、专业的分析。
要求：
- 分析必须基于真实的行业认知，不要编造数据
- 使用中文输出
- 保持专业、简洁、有洞察力
- 对于财务数据，标注为估算值并注明数据年份`;

/**
 * Step 1: Generate the industry chain skeleton.
 */
export function skeletonPrompt(industry: string): string {
  return `请分析"${industry}"行业的产业链结构。

要求：
1. 将产业链拆分为3-8个一级环节
2. 每个环节标注为 UPSTREAM（上游）、MIDSTREAM（中游）或 DOWNSTREAM（下游）
3. 按照从下游到上游的顺序排列（order=0 为最下游）
4. 为整个行业提供简要概述

输出格式严格按照 schema 定义。`;
}

/**
 * Step 2: Expand a node into sub-nodes.
 */
export function nodeExpansionPrompt(
  industry: string,
  nodeName: string,
  nodeDescription: string,
  depth: number
): string {
  return `在"${industry}"产业链中，"${nodeName}"环节的描述是：${nodeDescription}

请将该环节细分为2-6个子环节（当前层级深度为 ${depth}）。

对每个子环节：
1. 给出名称和详细描述
2. 标注产业链位置（UPSTREAM/MIDSTREAM/DOWNSTREAM）
3. 估算典型利润率范围
4. 估算市场规模
5. 分析增长趋势
6. 列出2-4个核心驱动因素

输出格式严格按照 schema 定义。`;
}

/**
 * Step 3: Discover companies for a chain node.
 */
export function companyDiscoveryPrompt(
  industry: string,
  nodeName: string,
  nodeDescription: string
): string {
  return `在"${industry}"产业链的"${nodeName}"环节（${nodeDescription}），请列出2-8家最具代表性的公司。

要求：
1. 优先列出行业龙头和上市公司
2. 覆盖不同市场地位（龙头/挑战者/新兴/细分）
3. 提供股票代码（如有）和交易所信息
4. 评估市场地位和预估市场份额
5. 列出核心产品/服务

输出格式严格按照 schema 定义。`;
}

/**
 * Step 4: Deep analysis for a specific company.
 */
export function deepAnalysisPrompt(
  companyName: string,
  industry: string,
  nodeName: string
): string {
  return `请对"${industry}"产业链"${nodeName}"环节中的"${companyName}"进行投研级深度分析。

要求提供：
1. 财务指标：市值、年营收、营收增速、毛利率、净利率、ROE、近3-5年趋势
2. 竞争分析：护城河/技术壁垒、主要竞争对手
3. 投资分析：3-5条投资亮点、3-5条风险提示、综合评级、客户集中度

注：财务数据如为估算请标注。

输出格式严格按照 schema 定义。`;
}

/**
 * Step 5: Profit chain analysis across the industry.
 */
export function profitChainPrompt(
  industry: string,
  nodes: Array<{ name: string; description: string; nodeType: string }>
): string {
  const nodeList = nodes
    .map((n) => `- ${n.name}（${n.nodeType}）：${n.description}`)
    .join("\n");

  return `请分析"${industry}"产业链的利润链条。

产业链环节如下：
${nodeList}

请对每个环节分析：
1. 典型利润率
2. 价值流转方式
3. 利润集中程度（HIGH/MEDIUM/LOW）
4. 利润率高低的原因

最后总结利润在产业链中的整体流向和集中趋势。

输出格式严格按照 schema 定义。`;
}

/**
 * Get the system prompt.
 */
export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
