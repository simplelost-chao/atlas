# Atlas × IndustryAnalysis 收敛方案

**日期**: 2026-05-31
**作者**: Claude (与项目所有者)
**状态**: 待与 atlas 作者对齐
**目的**: 两个独立起步、方法论相同的产业链挖掘项目演进为一个。本文给出深度对比、主干选择建议、以及分阶段收敛路线。

> **TL;DR**：atlas 是已部署的成熟产品，应作为主干。IndustryAnalysis 最有价值的、atlas 尚缺的能力是 **DAG 多父结构 + 别名实体消歧 + 跨主题 chokepoint 检测**——而这恰好是 atlas 自己 roadmap（"四轮发现""跨行业关联"）正在够向的东西。建议把这块能力作为一个聚焦的 PR 系列并入 atlas，而不是反向迁移或另起炉灶。

---

## 1. 两个项目是什么

| | **atlas**（同事，已部署） | **IndustryAnalysis**（我们，新 MVP） |
|---|---|---|
| 在线 | atlas.zhuchao.life | 本地 |
| 方法论 | Serenity chokepoint（System Prompt 几乎逐字一致） | Serenity 瓶颈五层法 + A–E 证据分级 |
| 覆盖行业 | AI / 机器人 / 自动驾驶 / 新能源 / 基因组学 / 商业航天（6） | ARK 2026 十三主题（含上述 + 比特币/DeFi/代币化/物流等） |
| 技术栈 | Next.js 16 · React 19 · tRPC v11 · **PostgreSQL+Prisma** · D3.js · Yjs 协作 · NextAuth | Python · FastAPI · **SQLite** · typer CLI · Cytoscape.js |
| LLM 集成 | **Claude CLI** (`claude -p --output-format json --allowedTools WebSearch,fetch`) + Vercel AI SDK 多模型路由（OpenAI/Anthropic，按 step 路由） | **QuantAgent CLI** subprocess（同样是 CLI 委托，零 API key） |
| 生成流水线 | **5 步**：骨架 → 环节细化 → 公司挖掘 → 深度分析 → 利润链 | **1 步**：expand（逐层下钻）；公司层/评分延后 |
| 公司层 | ✅ 完整 `Company` 模型 + **Yahoo Finance 实时数据**（市值/营收/毛利/ROE/PE/Beta… 20+ 字段，12 个交易所）+ 自动 market-position 排名（`auto-rank.ts`） | ⏳ `node_type=company` 类型已留，未填充；无金融数据 |
| 核心图结构 | **树**：`ChainNode.parentId`（单父）；按 Project（行业）隔离；另有 `SupplyRelation` 表表达公司间供需 | **DAG**：节点可多父；**别名实体消歧**；**跨主题共享节点 = chokepoint** |
| 协作/多租户 | ✅ Team/TeamMember/角色/邀请/评论/Yjs 实时协作 | ❌ 单机 |
| 成熟度 | 部署中、有运维脚本（备份/批量回填/金融同步）、状态监控页 | 33 测试、TDD、本地可跑 |

---

## 2. 各自的强项

### atlas 明显领先（我们短期追不上、也不该追）
- **完整产品形态**：认证、团队、协作、评论、移动适配、状态监控、自动备份。
- **公司层 + 真实金融数据**：Yahoo Finance 接入 12 个交易所，`live*` 字段，自动按真实市值算 LEADER/CHALLENGER/NICHE 排名。这是把"主题叙事"落到"可投资标的"的关键一跃，也是 Serenity 方法论第 5.3 节"财务验证"的落地。
- **5 步流水线**：骨架→细化→公司→深度分析→利润链，比我们的单步 expand 完整得多。
- **多模型路由**：可按 pipeline step 切 OpenAI/Anthropic，团队级 API key 管理。
- **JSON 解析鲁棒性**：`parseJSONWithRepair`（去尾逗号、补截断括号、转义换行）比我们的 `parse_candidates` 更抗 LLM 脏输出。

### IndustryAnalysis 独有（atlas 缺、且其 roadmap 正在够向）
- **DAG 多父结构**：一个环节可同时属于多个上游消费者/多个主题。atlas 的 `ChainNode` 是严格树（单 `parentId`），且每个 Project 一条独立 chain——**同一个物理材料（如 InP）在 AI 链和国防链里会被各自重新生成成两个互不相关的节点**。
- **别名实体消歧（entity resolution）**：`normalize()` + `aliases[]`，把 `InP / 磷化铟 / Indium Phosphide / CAS号` 收敛成同一节点。这是 Gemini review 反复强调、也是 chokepoint 检测能成立的前提。
- **跨主题 chokepoint 检测**：`ia chokepoints` 找出被 ≥2 个主题共享的节点。我们端到端验证过：伺服电机同时喂 Robotics 和 Autonomous Vehicles → 自动成为一个跨主题 chokepoint 节点。
- **挖掘幂等性**：重复 expand 同一节点会收敛（别名匹配 → skip/link，不产生近似重复）。
- **证据分级闸门**：A–E 分级 + proposed/confirmed 人工评审队列 + 可选 `auto_confirm_grade` 阈值。atlas 目前生成即入库，无 proposed/review 中间态。

---

## 3. 战略判断：这不是"二选一"，是"补齐"

atlas 的 `docs/algorithm-v2.md`（四轮公司挖掘）和 README roadmap 的未完成项里，明确写着要做：

- "**跨行业 chokepoint**"——一家特种气体化工公司，传统分类在化工，却是 AI 芯片制造的瓶颈，"只有 AI 能发现这种关联"。
- "数据关联扩展，不遗漏上市公司"、"AI 二次审视查漏补缺"。

**这些恰恰需要一个 DAG + 实体消歧的底座**：跨行业关联 = 同一节点被多个行业链引用 = 多父边；"不遗漏/不重复" = 别名去重。atlas 当前的"每 Project 一棵树"结构在数据模型层面就无法表达跨行业共享节点——它的 `SupplyRelation` 表能连公司，但 `ChainNode` 仍是单父树且按行业隔离。

**所以 IndustryAnalysis 的核心引擎 = atlas roadmap 缺的那块拼图。** 最优演进不是把 atlas 重写成 Python，也不是把 atlas 的金融层搬进我们的 SQLite，而是**以 atlas 为主干，把我们的 DAG/消歧/chokepoint 能力作为一个聚焦的能力并入**。

---

## 4. 主干选择：以 atlas 为主干（建议）

理由：
1. **沉没成本与成熟度**：atlas 已部署、有真实数据、有协作和金融层。让它放弃这些去迁就一个新 MVP，净损失。
2. **我们的增量是"能力"而非"产品"**：DAG+消歧+chokepoint 是一个可被并入的算法/数据模型升级，不需要 atlas 的 UI/认证/协作陪葬。
3. **方法论已天然一致**：两边 prompt 都是 Serenity 框架，收敛阻力小。

我们这边 `IndustryAnalysis` 仓的角色随之转变为：**算法孵化器 / 参考实现**——在这里用 Python 快速验证 DAG、消歧、chokepoint、证据闸门的逻辑（已有 33 测试做规格），然后把验证过的设计以 TypeScript/Prisma 形态移植进 atlas。

---

## 5. 数据模型收敛：把我们的 DAG 概念映射到 atlas 的 Prisma

这是整个收敛的技术核心。atlas 当前 `ChainNode` 是树，要支持跨主题 chokepoint，需要三处演进：

### 5.1 从"单父树"到"多父 DAG"

atlas 现状：
```prisma
model ChainNode {
  parentId String?           // 单父 → 树
  parent   ChainNode? @relation("NodeTree", ...)
  children ChainNode[] @relation("NodeTree")
}
```

建议演进：保留 `ChainNode` 作为展示树（向后兼容现有 UI），新增一张**显式上下游边表**表达 DAG（类比我们的 `edges` 表 + 我们已验证的环检测）：
```prisma
model ChainEdge {
  id           String @id @default(cuid())
  upstreamId   String   // 供给方
  downstreamId String   // 需求方
  rationale    String?
  @@unique([upstreamId, downstreamId])   // 我们 GraphStore 已有的唯一约束
}
```
配合一个加边时的**环检测**（我们 `store._reachable` 的 TS 移植，已端到端验证 a→b→c 拒绝 c→a）。

### 5.2 节点的实体消歧（最高价值）

atlas 现状：节点无别名、按 Project 隔离 → 跨行业必然重复。
建议：给 `ChainNode` 增加 `aliases String[]` 和一个规范化 key，并让"公司/环节挖掘"在写入前先按 `normalize(name)+aliases` 查重：
```prisma
model ChainNode {
  // ...
  aliases  String[] @default([])
  normKey  String   @db.Text   // normalize(name_en or name_cn)，建索引
  @@index([normKey])
}
```
`normalize()` 直接移植我们 `graph/models.py` 的实现（小写、去非字母数字、保留 CJK，已测）。挖掘命中已有节点 → 加一条 `ChainEdge` + union 所属行业，而不是新建节点。这正是我们 `mining/engine.py:expand` 的 (a)/(b)/(c) 三分支逻辑。

### 5.3 跨主题归属

我们的 `Node.theme_ids: list` → atlas 可用一张 `ChainNodeProject` 关联表（多对多），让同一 `ChainNode` 归属多个 `Project`/行业。`chokepoints(min_themes=2)` 查询 = "被 ≥2 个 Project 引用的 ChainNode"。

> **风险/取舍**：这是 atlas 数据模型的一次较大演进（树→DAG、Project 隔离→共享节点池）。需要 migration，且 D3 树视图要能处理 DAG（一个节点多父）。建议先在新行业上启用共享节点池，老数据保持兼容。

---

## 6. 分阶段收敛路线

每个阶段都是独立可交付、可在 atlas 开 PR 评审的增量。

### Phase 0 — 对齐与决策（本周）
- 本文档 + atlas 作者一起过一遍，确认"atlas 为主干、并入 DAG 能力"。
- 决定数据模型演进的兼容策略（新行业先行 vs 全量 migration）。
- 产出：一份双方签字的收敛 ADR（架构决策记录）。

### Phase 1 — 实体消歧（最高 ROI，先做）
- 在 atlas 移植 `normalize()` + `aliases[]` + `normKey` 索引 + 写入前查重。
- 改造 pipeline Step 3（公司挖掘）和 Step 2（环节细化）：命中已有节点则连边/合并，不新建。
- **价值立现**：立刻消除跨行业重复，且不需要先改成 DAG。
- 我可在 IndustryAnalysis 仓先用 Python 把查重/合并规则跑通（已有 `test_store_dedup` / `test_mining_engine` 做规格），再给 atlas 出对应 TS + Prisma PR。

### Phase 2 — DAG 边表 + 环检测
- 新增 `ChainEdge` 表 + 加边环检测（移植 `_reachable`）。
- `ChainNode` 多 Project 归属（关联表）。
- D3 树视图改造为支持多父（或先在"目录视图"暴露跨链关系，树视图后续）。

### Phase 3 — 跨主题 chokepoint
- 实现 `chokepoints(min_themes≥2)` 查询 + 一个"全局瓶颈"视图（跨所有行业，不限单个 Project）。
- 这是两个项目合体后才有、单独任一方都给不出的旗舰功能。

### Phase 4 — 证据闸门（可选）
- 把我们的 A–E 证据分级 + proposed/confirmed 评审队列引入 atlas，作为生成结果入库前的质量门控（atlas 现在生成即入库）。
- 配合 atlas 已有的 Yjs 协作/评论，人工评审体验会很好。

### 反向取用（我们从 atlas 拿什么）
- 若 IndustryAnalysis 仓继续作为算法孵化器，可借鉴 atlas 的 `parseJSONWithRepair`（比我们的 parser 更鲁棒）和 5 步 prompt 结构。

---

## 7. 我现在能立即做的

按优先级，等你和同事对齐后我可以：

1. **（推荐先做）** 在 IndustryAnalysis 仓把 Phase 1 的"实体消歧 + 合并规则"打磨成一份清晰的参考实现 + 规格测试，作为给 atlas 的 PR 蓝本。
2. 直接在 atlas 开 `feat/entity-resolution` 分支，出 Prisma migration + TS 实现 + 测试的 PR（你有写权限）。
3. 写这次收敛的 ADR（架构决策记录），落到 atlas 仓的 `docs/`。

---

## 附：关键文件对照

| 能力 | atlas | IndustryAnalysis |
|---|---|---|
| LLM 调用 | `src/server/ai/claude-cli.ts` | `src/industry_analysis/quantagent/client.py` |
| 挖掘流水线 | `src/server/ai/pipeline.ts`（5步） | `src/industry_analysis/mining/engine.py`（expand/batch） |
| Prompt | `src/server/ai/prompts.ts` | `src/industry_analysis/mining/prompt.py` + `.quantagent/agents/chain-miner.md` |
| 数据模型 | `prisma/schema.prisma`（树） | `src/industry_analysis/graph/models.py` + `store.py`（DAG） |
| 实体消歧 | ❌（待并入） | `graph/models.normalize` + `store.find_by_name` |
| chokepoint | ❌（roadmap） | `store.chokepoints` |
| 公司+金融 | `services/market-data.ts` + `auto-rank.ts` | ❌（延后） |
| 可视化 | D3.js 树 | Cytoscape.js DAG |
