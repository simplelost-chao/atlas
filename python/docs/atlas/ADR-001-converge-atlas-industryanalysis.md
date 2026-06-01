# ADR-001: 将 IndustryAnalysis 的 DAG/实体消歧能力并入 atlas

**状态**: 提议（待 atlas 作者与项目所有者签署）
**日期**: 2026-05-31
**决策者**: IndustryAnalysis owner + atlas author
**相关**: `docs/atlas-convergence-plan.md`（深度对比），`docs/atlas/PHASE1-entity-resolution-blueprint.md`（实施蓝图）

---

## 背景

两个独立起步的项目实现了相同的产业链瓶颈（Serenity chokepoint）挖掘方法论：

- **atlas**（`github.com/simplelost-chao/atlas`，已部署 atlas.zhuchao.life）：成熟全栈产品。Next.js 16 / tRPC / PostgreSQL+Prisma / D3.js / Yjs 协作 / NextAuth。完整 5 步 AI 流水线（含已实现的 V2 四轮公司发现 `discovery-v2.ts`）、Yahoo Finance 实时金融数据、自动市场地位排名。
- **IndustryAnalysis**（新 Python MVP，33 测试）：FastAPI/SQLite/typer/Cytoscape.js。核心是一个 **DAG + 别名实体消歧 + 跨主题 chokepoint** 引擎。

两者要演进为一个项目。

## 决策

1. **atlas 是主干。** 保留并继续发展 atlas 的产品形态、金融层、协作、流水线。
2. **IndustryAnalysis 转为算法孵化器 / 参考实现。** 在 Python 侧用快速 TDD 验证图算法（实体消歧、DAG 环检测、跨主题 chokepoint、证据闸门），验证后以 TS/Prisma PR 形态移植进 atlas。
3. **第一个并入能力是实体消歧（entity resolution）。** 这是 ROI 最高、改动面最小、且不依赖数据模型大改的一步。

## 理由

### 为什么 atlas 当主干
- 已部署、有真实数据与用户路径（认证/团队/协作/金融）。让成熟产品迁就新 MVP 是净损失。
- 我们的增量是"一项能力"而非"一个产品"，可被并入，无需 atlas 的 UI/协作陪葬。
- 方法论已天然一致（两边 system prompt 都是 Serenity 框架）。

### 为什么实体消歧是 atlas 真正缺的、且是它 roadmap 的前置条件
读 atlas 源码确认的现状：

| 位置 | 现状 | 问题 |
|---|---|---|
| `pipeline.ts:183` `runNodeExpansionStep` | 子环节直接 `db.chainNode.create`，**无任何查重** | 同一环节在不同父/不同行业下无限重复 |
| `pipeline.ts:242` `runCompanyDiscoveryStep` | 公司直接 `create`，**无查重** | 同一公司重复 |
| `discovery-v2.ts:369` `discoverCompaniesV2` | 查重 = `name.toLowerCase()` + `ticker.toUpperCase()`，**且仅限单个 node 内** | 跨 node、跨行业完全不去重；无规范化（"磷化铟"≠"InP"≠"Indium Phosphide"）；无别名 |
| `schema.prisma` `ChainNode` | 单 `parentId`（树），按 `Project`（行业）隔离 | 同一物理实体（InP、伺服电机）在 AI 链和国防链里是两个互不相关的节点 |

而 atlas 自己的 `docs/algorithm-v2.md` 和 README roadmap 明确要做 **"跨行业 chokepoint"**（"一家特种气体化工公司……只有 AI 能发现这种关联"）。**跨行业关联在数据层面 = 同一节点被多个行业引用 = 需要先能识别"这是同一个实体"。** 没有实体消歧，跨行业 chokepoint 无法落地。

IndustryAnalysis 已经把这套逻辑用 Python 跑通并测试（`normalize()` + `aliases[]` + `find_by_name` + expand 的 skip/link/create 三分支 + 幂等性），可直接作为 atlas 的移植蓝本。

## 收敛阶段（每阶段独立可交付、可在 atlas 评审）

| Phase | 内容 | 数据模型改动 | 风险 |
|---|---|---|---|
| **1. 实体消歧** | `normalize()` + `aliases[]` + `normKey` 索引 + 写入前查重；改造 pipeline Step 2/3 与 discovery-v2 的 create 逻辑为 find-or-link | 仅给 `ChainNode`/`Company` 加字段（加列，非破坏性） | 低 |
| 2. DAG 边表 + 环检测 | 新增 `ChainEdge` 表 + 加边环检测；`ChainNode` 多 Project 归属 | 新表 + 关联表；D3 树视图需支持多父 | 中 |
| 3. 跨主题 chokepoint | `chokepoints(min_themes≥2)` 查询 + 全局瓶颈视图 | 无（查询层） | 低 |
| 4. 证据闸门（可选） | A–E 分级 + proposed/confirmed 评审队列 | `ChainNode`/`Company` 加 status/grade 字段 | 中 |

## 兼容策略
- Phase 1 全部是**加列**，对现有数据与 UI 向后兼容。
- Phase 2 的树→DAG 是较大演进：建议**新行业先启用共享节点池**，存量行业保持单父树，逐步迁移。

## 后果

**正面**
- atlas 立刻消除跨行业/跨环节重复，数据质量提升。
- 解锁 atlas roadmap 的旗舰功能（跨行业 chokepoint）。
- 两个项目合一，不再重复造轮子；Python 侧作为低成本算法验证场。

**负面 / 成本**
- atlas 需要 Prisma migration 和写入路径改造（Phase 1 已是最小化）。
- 维护两套语言实现（Python 参考 + TS 生产）——通过"Python 先验证、TS 跟随"的单向流减轻；长期若 atlas 完全覆盖，可冻结 Python 侧为纯规格测试。

## 替代方案（已否决）
- **以 IndustryAnalysis 为主干，把 atlas 金融/协作迁过来**：要重建 atlas 的认证/协作/部署/金融层，成本远高，且丢弃已部署产品。
- **全新融合项目**：双方成熟代码全部重写，最慢，收益最低。

## 待确认问题（签署前）
1. atlas 作者是否认可"atlas 为主干 + 增量并入"？
2. Phase 2 的树→DAG 改造，UI（D3 树）层面接受度如何？是否先只在目录视图暴露跨链？
3. Python 参考实现的长期定位：持续孵化器，还是 atlas 追平后冻结为规格？
