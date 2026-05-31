import type { PipelineStep } from "./llm-router";

/**
 * System prompt — Serenity-inspired supply chain investment analyst.
 */
const SYSTEM_PROMPT = `你是一位资深产业链分析师和投资研究专家，擅长从供应链视角挖掘投资机会。

核心分析框架：

1. **供应链瓶颈理论 (Chokepoint Theory)**：最暴利的投资机会不在终端产品，在那些控制着不可替代输入的公司——如果它们断供，整个行业就停摆。
2. **不可替代性分析**：关键问题不是"这家公司好不好"，而是"如果这家公司明天关门，谁会受最大影响？有没有替代供应商？"
3. **信息不对称套利**：最好的机会在"市值太小被机构跳过 + 技术太深被散户忽略"的交叉地带——每个行业都有这种隐形冠军。
4. **行业领袖信号**：跟踪该行业最大玩家的投资/并购/合作动向——它们押注什么方向，那个方向的 chokepoint 就会兑现。
5. **估值纪律**：chokepoint 不等于好投资——估值、流动性、drawdown 风险同样重要。

要求：
- 分析必须基于真实的行业认知，不要编造数据
- 使用中文输出
- 保持专业、简洁、有洞察力
- 对于财务数据，标注为估算值并注明数据年份
- 特别关注 chokepoint 公司——控制不可替代环节的小公司往往是最大的 alpha`;

/**
 * Step 1: Generate the industry chain skeleton.
 */
export function skeletonPrompt(industry: string): string {
  return `请分析"${industry}"行业的产业链结构。

要求：
1. 根据该行业的实际结构，拆分出所有关键的一级环节，数量不限，该行业有多少个关键环节就列多少个，不要人为限制
2. 每个环节标注为 UPSTREAM（上游）、MIDSTREAM（中游）或 DOWNSTREAM（下游）
3. 按照从下游到上游的顺序排列（order=0 为最下游）
4. 为整个行业提供简要概述
5. 特别关注那些容易被忽略但实际控制关键瓶颈的上游环节（如特殊材料、关键设备、稀缺工艺）

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

请将该环节按实际情况细分为所有关键子环节（当前层级深度为 ${depth}），数量不限，有多少就列多少。

对每个子环节：
1. 给出名称和详细描述
2. 标注产业链位置（UPSTREAM/MIDSTREAM/DOWNSTREAM）
3. 估算典型利润率范围
4. 估算市场规模
5. 分析增长趋势
6. 列出2-4个核心驱动因素

特别注意：
- 不要只列大的、明显的子环节，也要挖掘那些"小但不可替代"的关键细分（如特殊材料、关键零部件、稀缺工艺）
- 这些"隐形瓶颈"往往利润率最高、护城河最深

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
  return `在"${industry}"产业链的"${nodeName}"环节（${nodeDescription}），请列出该环节所有重要的代表性公司，数量不限。

挖掘策略（参考 Serenity 的 chokepoint 方法论）：

1. **龙头公司**：该环节的绝对领导者，市场份额最大
2. **Chokepoint 公司（最重要）**：不一定是最大的，但控制着不可替代的关键技术/材料/工艺。如果它断供，整个供应链就会出问题。这类公司往往：
   - 市值较小，被机构忽略
   - 技术壁垒极高，竞争对手难以复制
   - 客户包括该行业的巨头公司（行业 top 玩家）
3. **挑战者**：正在快速崛起的竞争者
4. **细分龙头**：在特定细分市场占主导的公司

市场地位判断标准（必须严格遵守）：
- LEADER（龙头）：全球范围内该环节的绝对领导者，技术和市场份额都处于第一梯队。一个环节通常只有1-3个真正的龙头。注意区分"全球龙头"和"区域龙头"——如果一家公司只在某个国家领先但全球份额不高，应标为 CHALLENGER 而非 LEADER。
- CHALLENGER（挑战者）：有实力的竞争者，技术和市场份额处于第二梯队，正在追赶龙头。
- EMERGING（新兴）：成立时间短、增长快但尚未形成显著市场份额的公司。
- NICHE（细分）：在某个特定细分领域占主导的公司。

要求：
- 优先列出上市公司，提供股票代码和交易所
- 不要只列大家都知道的大公司，特别要挖掘那些"市值太小被机构跳过、技术太深被散户忽略"的隐形冠军
- 覆盖中国、美国、欧洲、日韩的公司，不要只局限于美股
- 对每家公司评估市场地位和市场份额
- 同一环节不要把太多公司都标为 LEADER，真正的龙头是稀缺的

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

分析框架（参考 Serenity 的供应链瓶颈投资方法论）：

**1. 财务指标**
- 市值、年营收、营收增速、毛利率、净利率、ROE
- 近3-5年趋势数据
- 财务数据如为估算请标注

**2. 供应链位置与不可替代性（关键）**
- 这家公司在供应链中控制了什么不可替代的东西？
- 如果它明天关门，谁会受最大影响？
- 有没有替代供应商能做同样的事？如果没有，这就是 chokepoint
- 它的客户是谁？有没有该行业的巨头公司在买它的产品/服务？

**3. 护城河分析**
- 技术壁垒有多高？竞争对手要多久才能追上？
- 专利/工艺/良率/规模优势
- 主要竞争对手是谁？

**4. 投资分析**
- 3-5条投资亮点（特别关注 chokepoint 属性）
- 3-5条风险提示（包括估值风险、流动性风险、技术替代风险）
- 综合评级
- 客户集中度分析
- 机构关注度如何？是否被低估？

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
2. 价值流转方式——钱怎么从下游流到上游？
3. 利润集中程度（HIGH/MEDIUM/LOW）
4. 利润率高低的原因——是技术壁垒？规模效应？还是 chokepoint 垄断？

特别关注：
- 哪些环节是 chokepoint——掌握定价权，下游不得不买单？
- 利润是否在向某些"隐形瓶颈"集中？
- 哪些环节看起来利润率低但实际上控制着整个链条的命脉？

最后总结利润在产业链中的整体流向和集中趋势。

输出格式严格按照 schema 定义。`;
}

/**
 * Get the system prompt.
 */
export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
