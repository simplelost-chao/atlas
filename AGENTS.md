<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Atlas — 产业链分析平台

Atlas 是一个 AI 驱动的产业链分析平台，帮助投资者系统性地挖掘供应链瓶颈（Serenity Chokepoint 方法论），发现被低估的投资标的。

## 仓库结构

```
atlas/
  src/               # Next.js 前端 + tRPC 后端（TypeScript）
  prisma/            # PostgreSQL schema（TypeScript 权威数据模型）
  python/            # Python 算法层（IndustryAnalysis）
  docs/              # 设计文档、架构说明
```

## 两层架构

| 层 | 目录 | 语言 | 职责 |
|---|---|---|---|
| **产品层** | `src/`, `prisma/` | TypeScript | UI、API、5步流水线、公司挖掘、Yahoo Finance 金融数据 |
| **算法层** | `python/` | Python | DAG 图挖掘、实体消歧、供应链数据源（A股/美股原始披露文本）|

两层通过约定好的接口协作：Python 层构建数据基础，TypeScript 层消费并展示。

---

## TypeScript 层（src/）

### 架构
- **框架**: Next.js 16 App Router + tRPC v11 + PostgreSQL/Prisma
- **AI 流水线**: `src/server/ai/pipeline.ts` — 5步：骨架→环节细化→公司挖掘→深度分析→利润链
- **LLM**: Claude CLI (`src/server/ai/claude-cli.ts`) + Vercel AI SDK 多模型路由
- **实体消歧**: `src/server/lib/normalize.ts` — normalize() 防止同一材料被重复建档
- **金融数据**: `src/server/services/market-data.ts` — Yahoo Finance（市值/营收/PE 等 20+ 字段）
- **协作**: Yjs + Hocuspocus 实时多人编辑
- **认证**: NextAuth.js + 团队权限

### 关键命令
```bash
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev:next          # http://localhost:3000
npm test                  # vitest
```

### 关键文件
- `src/server/ai/pipeline.ts` — 5步生成流水线
- `src/server/ai/prompts.ts` — Serenity 框架 Prompt 模板
- `src/server/lib/normalize.ts` — 实体规范化（防重复）
- `src/server/services/entity-resolution.ts` — findNodeByName / findCompanyByTickerOrName
- `prisma/schema.prisma` — 数据模型（ChainNode + Company + aliases/normKey）

---

## Python 算法层（python/）

IndustryAnalysis：产业链 DAG 挖掘引擎 + 原始披露数据源。

### 核心设计
- **无 LLM 直调**：所有推理通过 QuantAgent CLI subprocess 完成
- **三文件数据架构**：
  - `<cache>/CN/filings.db` — A 股年报 + 招股书（巨潮 cninfo T1 来源）
  - `<cache>/US/filings.db` — 美股 10-K + S-1（SEC EDGAR，edgartools）
  - `<cache>/datasource.db` — companies 注册表 + mentions + FTS5 trigram 全文索引
- **DAG 图**：支持多父节点（同一材料跨多主题共享 → 自动识别跨行业 chokepoint）
- **未上市公司一等公民**：从招股书供应商/客户段落提取，无 ticker 也可入库

### 关键命令
```bash
cd python
pip install -e ".[dev]"
pytest                    # 68 tests

# 产业链挖掘
ia theme load             # 载入 13 个 ARK 2026 主题
ia expand robotics        # 挖掘机器人产业链上游节点
ia review list            # 评审候选节点
ia chokepoints            # 列出跨主题瓶颈

# 数据源 workers
ia datasource cn-fetch --symbols 600519.SH 688036.SH
ia datasource us-fetch --tickers NVDA AVGO AAOI
ia datasource index
ia datasource search "谐波减速器"

# Dashboard
uvicorn industry_analysis.dashboard.app:app --port 8300
```

### Python 层关键文件
- `python/src/industry_analysis/datasource/` — 数据源层（filings + FTS5）
- `python/src/industry_analysis/graph/` — DAG 图存储（cycle check、alias dedup、chokepoints）
- `python/src/industry_analysis/mining/` — expand 引擎（幂等、跨主题链接）
- `python/.quantagent/agents/chain-miner.md` — 产业链挖掘 agent 定义
- `python/seeds/ark_themes_2026.yaml` — 13 个 ARK 2026 主题种子

---

## 两层如何协作

### 当前阶段（Phase 1 — 实体消歧）
TypeScript 层已引入 `normalize()` + `aliases/normKey` 字段（Prisma 已迁移），防止同一环节/公司因命名不同被重复创建。这是 Python 层 DAG 实体消歧逻辑在 TS 侧的移植。

### 下一阶段（Phase 2 — 数据源接入）
- Python `ia datasource search "InP衬底"` 返回相关披露文件 + 上下文片段
- 用于验证 atlas 流水线挖掘到的公司/环节是否真实存在于年报/招股书中

### 长期方向（Phase 3 — DAG 边表）
- atlas Prisma 新增 `ChainEdge` 表，支持 ChainNode 多父引用
- Python 的跨主题 chokepoint 逻辑（`ia chokepoints`）映射到 atlas 的全局视图

---

## 收敛方案文档
详见 `python/docs/atlas-convergence-plan.md` 和 `python/docs/atlas/ADR-001-converge-atlas-industryanalysis.md`。
