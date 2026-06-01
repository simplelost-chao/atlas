# IndustryAnalysis — 产业链研究与挖掘系统 设计文档

**版本**: v0.2（v0.1 经 Gemini 评审后修订：实体消歧/别名、重复 expand 幂等、SQLite 单一事实来源、评审防积压）
**日期**: 2026-05-30
**状态**: 待用户评审
**输入方法论**:
- `../DailyAnalysis/docs/frameworks/瓶颈资产挖掘方法论.md`（Serenity/AXTI 五层下钻 + A–E 证据分级 + 100 分评分）
- `../DailyAnalysis/docs/ARKInvest_BigIdeas2026_主题机会提炼.md`（13 个主题 + 子方向）
- `../DailyAnalysis/docs/产业链瓶颈挖掘_SpaceX_AI_机器人_2026-05-29.md`（已有的人工示范）

---

## 1. 目标与定位

构建一个**产业链研究与挖掘系统**：从 ARK 2026 的核心主题出发，沿"下游 → 上游"逐层挖掘出产业链节点（主题 → 子行业/环节 → 模组 → 组件 → 材料/前驱体 → 设备 → 公司），形成一张**有向无环图（DAG）**，并提供：

- **CLI**：供 Agent 和人类调用（查询、挖掘、评审、导出）。
- **Dashboard**：供人类交互式浏览 DAG、查看节点详情、识别跨主题瓶颈。

**第一步只挖到"环节/子行业"层**（例如：机器人 → 伺服电机；AI → 芯片、服务器），再逐层向上游下钻；公司层（资本市场层）类型在数据模型中保留，但 MVP 不批量填充。

### 设计约束（来自需求澄清）

| 决策点 | 选择 |
|---|---|
| 挖掘推理来源 | **复用 QuantAgent CLI**（沿用 DailyAnalysis 模式，本项目不直接调 LLM） |
| 核心数据结构 | **有向无环图 DAG**（节点可被多个父/主题共享） |
| 挖掘控制方式 | **手动单步 expand + 可选自动批量 batch_expand**（批量结果进待评审队列，不自动入图） |
| 公司定位 | **DAG 最深层节点**（`node_type=company`，资本市场层），MVP 保留类型不批量填充 |
| MVP 边界 | 主题库 + 逐层挖掘引擎 + 图存储 + CLI + 基础 dashboard。**不含**公司层填充、不含 100 分评分模型 |
| 技术栈 | SQLite（图权威存储）+ per-node markdown（证据/研究叙事）+ FastAPI + 单页 Cytoscape.js |

---

## 2. 架构总览

```
                ┌─────────────────────────────────────────────┐
                │              IndustryAnalysis                │
                │  (Python orchestrator + 存储 + 表现层)        │
                │                                              │
   ARK themes ─▶│  themes/  ─▶  graph/ (SQLite DAG)             │
                │                 ▲         │                  │
                │  mining/  ──────┘         ▼                  │
                │    │              review/ (proposed→confirmed)│
                │    │                                          │
                │    ▼                       ┌──────────────┐   │
                │  quantagent/client.py ─────▶  CLI (ia ...) │◀──┼── Agent / 人
                │    │ subprocess                └──────────────┘   │
                │    ▼                       ┌──────────────┐   │
                │  .quantagent/agents/*.md   │ dashboard/   │◀──┼── 人 (浏览器)
                │  (chain-miner,             │ FastAPI +    │   │
                │   chain-quality-checker)   │ Cytoscape.js │   │
                └────────┬───────────────────┴──────────────┘   │
                         │ node ../QuantAgent/dist/cli.js
                         ▼
                   ┌──────────────┐
                   │  QuantAgent  │  (LLM 推理引擎，WebSearch/WebFetch)
                   └──────────────┘
```

**关键原则**：IndustryAnalysis 本身**不做 LLM 推理**。所有挖掘/质检通过 QuantAgent CLI 完成，调用方式参照 `../DailyAnalysis/src/daily_analysis/quantagent/client.py`：

```
node ../QuantAgent/dist/cli.js --agent <name> --agents-dir .quantagent/agents --prompt <prompt>
```

**可复用的现有 agent**：DailyAnalysis 的 `.quantagent/agents/` 已有 `theme-scout.md`、`bottleneck-scorer.md`、`quality-checker.md`。本项目在自己的 `.quantagent/agents/` 下新增 `chain-miner.md`（逐层挖掘），并可参照/适配上述现有 agent 作为 `chain-quality-checker.md` 的基础。

---

## 3. 核心数据模型

### 3.1 Node（节点）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str (slug) | 规范化唯一标识，如 `inp-substrate` |
| `name_cn` | str | 规范中文名，如「磷化铟衬底」 |
| `name_en` | str | 规范英文名，如「InP Substrate」 |
| `aliases` | str[] | 别名/同义词/化学式/代号，如 `["InP", "Indium Phosphide", "磷化铟"]`。**实体消歧的核心**：去重按规范名 + 别名集合匹配，避免同一物理实体因命名不同被拆成多个节点（否则 `chokepoints` 失效） |
| `node_type` | enum | `theme` / `sub_industry` / `module` / `component` / `material` / `precursor` / `equipment` / `company` |
| `bottleneck_layer` | enum / null | 正交标签：技术物理层 / 工艺设备层 / 材料前驱体层 / 量产生态层 / 资本市场层 |
| `theme_ids` | str[] | 该节点归属的根主题（可多个，跨主题共享的关键信号） |
| `description` | str | 一句话定位（为什么是这一环节） |
| `status` | enum | `proposed`（待评审） / `confirmed`（已入图） / `rejected` |
| `evidence_grade` | enum / null | A–E（来自方法论 §5.4），MVP 由 chain-miner 给出初判 |
| `metadata` | json | 预留：评分、催化剂、证伪点、来源链接等（MVP 不强制） |
| `created_at` / `updated_at` | ts | |

> `node_type` 标记"是什么"，深度是自由的（不强制固定层数）；`bottleneck_layer` 是另一维正交标签，用于方法论里的瓶颈定位。

### 3.2 Edge（边）

| 字段 | 类型 | 说明 |
|---|---|---|
| `from_id` | str | 上游节点（被依赖方） |
| `to_id` | str | 下游节点（依赖方） |
| `relation` | enum | `upstream_of`（from 是 to 的上游 / to 需要 from） |
| `rationale` | str | 该上下游关系的理由（一句话） |

**约束**：插入边时做**环检测**（DAG 不允许成环）；`(from_id, to_id)` 唯一。跨主题共享通过同一节点拥有多条来自不同上下文的 `upstream_of` 边来表达（不引入单独的 `shared_with` 边类型）。

### 3.3 存储

- **权威图结构**：SQLite，单文件 `data/graph.db`（表 `nodes`、`edges`、`review_log`）。利于 DAG 递归查询、去重、环检测。
- **单一事实来源（重要）**：SQLite 是**唯一权威**，包括节点证据/研究叙事——存于 `nodes.evidence_md` TEXT 列。这样 `evidence_grade` 与其支撑文字在同一事务内更新，删边不会孤立 markdown 里的 rationale，避免"结构在库、文字在文件"两套来源的同步 bug。
- **markdown 是导出投影，不是事实来源**：`ia graph export --md` 把 `evidence_md` 投影成 per-node markdown（路径 `kb/<theme>/<node_id>.md`，沿用 DailyAnalysis 的 `<!-- section_meta: {...} -->` 分节约定），供人类阅读与未来 InvestmentWorkspace KB 集成。这些文件**只读再生**，不在原地编辑当作真相。
- **Dashboard 数据**：FastAPI 直接查 SQLite；`ia graph export --json` 提供离线导出。

---

## 4. 挖掘流程（mining/）

### 4.1 单步 expand

```
expand(node_id):
  1. 读取 node 上下文（自身 + 从根主题到该节点的父链路径 + 已确认的同层兄弟，避免重复挖掘）
  2. 构造 prompt：节点上下文 + 五层下钻方法论 + 显式 JSON 输出 schema
  3. quantagent_client.run("chain-miner", prompt)  → QuantAgent CLI subprocess
  4. 解析 stdout 为结构化候选子节点（pydantic 校验）
       - 解析失败：存 raw + 标记 parse_error，loudly 报错（Rule 12），不静默
  5. 实体消歧 + 幂等：每个候选先按"规范名 + aliases 集合"做归一化匹配：
       (a) 命中该节点已有的子节点      → 跳过（幂等：重复 expand 不产生近似重复）
       (b) 命中图中其它已有节点        → 新增 upstream_of 边（DAG 跨链；瓶颈共享信号来源），不新建节点
       (c) 全新                        → 插入 node(status=proposed) + 边，进入待评审队列
```

> 幂等性：对同一节点重复 expand（LLM 输出会有波动）必须收敛——已存在的子节点不重复创建，别名命中则合并/连边，仅真正新增的进入队列。这是 (a)/(b) 两条分支的目的。

### 4.2 自动批量 batch_expand

```
batch_expand(node_id, depth=N):
  BFS 递归调用 expand，最多展开 N 层
  所有新节点一律 status=proposed（进队列），永不自动 confirmed
  每层之间记录日志（展开了哪些节点、产生多少候选），便于事后清理
```

### 4.3 QuantAgent agent 定义（`.quantagent/agents/`）

- **`chain-miner.md`**：YAML frontmatter（`name` / `description` / `model` / `tools: [WebSearch, WebFetch]` / `instructions`）+ markdown body。body 内嵌入五层下钻方法论与 A–E 证据分级要求，并**强制输出固定 JSON schema**：候选子节点数组，每项含 `name_cn / name_en / node_type / bottleneck_layer / description / evidence_grade / relation_rationale / sources`。
- **`chain-quality-checker.md`**（**后续阶段，非 MVP**）：对一批候选做质检（去重建议、证据等级是否过高、是否只是概念沾边）。MVP 阶段人工评审闸门已承担该职责，故延后；后续可基于现有 `quality-checker.md` / `bottleneck-scorer.md` 适配。

格式参照 `../DailyAnalysis/.quantagent/agents/theme-scout.md` 等现有 agent。

---

## 5. 评审与提交（review/）

- `proposed` 节点进入待评审队列；`review_log` 记录每次动作（时间、动作、操作者、目标）。
- 操作：`approve`（→ confirmed） / `reject`（→ rejected，软删除） / `merge`（合并到已有节点，多余边转为指向保留节点）。
- 人工单步与自动批量产生的候选**都**经过同一评审闸门，符合方法论的证据门控。
- **防止队列积压**（`batch_expand --auto-depth N` 会一次产生大量候选）：
  - **批量评审**：`ia review approve/reject` 支持按 `--theme` / `--node-type` / `--min-grade` 过滤后批量操作。
  - **可选自动确认阈值**：配置项 `auto_confirm_grade`（默认关闭）。开启后，证据等级达标的**结构性**节点（如 sub_industry / module）可直接 confirmed，只有低证据或材料/前驱体等高价值瓶颈层进入人工队列。证据门控保留，但人不必逐条点。

---

## 6. 主题加载（themes/）

- 一个种子文件 `seeds/ark_themes_2026.yaml`，从 `ARKInvest_BigIdeas2026_主题机会提炼.md` 提炼 13 个主题（id / name_cn / name_en / 核心方向）。
- `ia theme load` 把主题写入图作为 `node_type=theme` 的根节点（confirmed）。
- 可选：种子文件也可预置每个主题已知的第一层子方向（来自提炼.md 的"瓶颈资产角度"），作为 proposed 候选写入（仍走评审，不直接 confirmed）。

---

## 7. CLI（cli/，单一入口 `ia`，基于 typer）

人类可读输出 + `--json`（供 Agent 消费）。

| 命令 | 作用 |
|---|---|
| `ia theme load` | 种子写入 13 个 ARK 主题根节点 |
| `ia node show <id>` / `ia node list [--type --theme --status]` | 查询节点 |
| `ia node path <id>` | 显示从根主题到该节点的上下游路径 |
| `ia expand <id>` | 单步挖掘（结果进待评审队列） |
| `ia expand <id> --auto-depth N` | 自动批量挖掘 N 层（进队列） |
| `ia review list [--theme]` / `ia review approve <id>` / `ia review reject <id>` / `ia review merge <id> --into <id2>` | 评审 |
| `ia search <kw>` | 按名称/描述搜索节点 |
| `ia chokepoints` | 列出被 ≥2 个主题共享的节点（跨主题瓶颈候选） |
| `ia graph export --json [--out f]` | 导出整图 JSON 给 dashboard / 离线分析 |
| `ia graph export --md [--out dir]` | 把 `evidence_md` 投影成 per-node markdown（只读再生，供阅读/KB 集成） |

---

## 8. Dashboard（dashboard/）

- **后端**：FastAPI，复用 graph/ 与 mining/ 引擎。端点示例：
  - `GET /api/graph` → 整图 JSON（节点 + 边）
  - `GET /api/node/{id}` → 节点详情 + markdown 证据
  - `POST /api/expand/{id}` → 触发挖掘（进队列）
  - `GET /api/review` / `POST /api/review/{id}` → 评审
  - `GET /api/chokepoints` → 跨主题共享节点
- **前端**：单页 `static/index.html` + **Cytoscape.js**（CDN，无构建步骤）。
  - 左：DAG 画布（按 node_type 着色，跨主题/共享节点高亮）。
  - 右：节点详情面板（字段 + markdown 证据 + expand/review 按钮）。
  - 顶：主题筛选、搜索、"只看瓶颈"开关。
- 端口约定：`8300`（避开 MDS 8100 / DailyAnalysis 8200）。

---

## 9. 错误处理与一致性

- **QuantAgent 失败**：client 捕获非零退出码并 `raise`，CLI/Dashboard loudly 报错，不静默吞掉（Rule 12）。
- **解析失败**：保留 raw 输出 + 标记，不污染图。
- **去重/合并**：规范化 name 比对；命中即建 `upstream_of` 边而非重复节点——这是 DAG 跨链与瓶颈识别的核心机制。
- **环检测**：每次加边前验证不成环。
- **事务**：一次 expand 的写入在一个事务内完成，失败回滚。

---

## 10. 测试（tests/，编码意图而非仅行为）

| 测试 | 验证的意图 |
|---|---|
| graph CRUD + 唯一约束 | 图存储正确 |
| **DAG 无环不变量** | 加边成环时必须拒绝——产业链上下游不能循环 |
| 实体消歧：别名命中 → 共享边 | `InP`/`磷化铟`/`Indium Phosphide` 视为同一节点，不重复建点而是建跨链边（瓶颈识别前提） |
| **重复 expand 幂等** | 对同一节点二次 expand（候选含已存在子节点）不产生近似重复，结果收敛 |
| prompt 构造器 | expand 注入了父链上下文与方法论，避免重复挖掘 |
| 评审状态机 | proposed→confirmed/rejected/merged 转移合法 |
| CLI 命令（mock QuantAgent） | 不依赖真实 LLM 即可验证编排逻辑 |
| chokepoints 查询 | 被 ≥2 主题共享的节点被正确识别 |

---

## 11. 项目结构

```
IndustryAnalysis/
├── pyproject.toml              # 包名 industry-analysis，依赖 fastapi/uvicorn/pydantic/pydantic-settings/typer/pyyaml/loguru
├── AGENTS.md / CLAUDE.md       # 约定（仿 DailyAnalysis）
├── .env                        # IA_ 前缀配置（QuantAgent 路径、端口、db 路径）
├── .gitignore                  # data/*.db, __pycache__, .venv
├── seeds/ark_themes_2026.yaml
├── .quantagent/agents/
│   └── chain-miner.md          # chain-quality-checker.md 延后到后续阶段
├── kb/                         # ia graph export --md 的输出（再生投影，gitignore 可选）
├── src/industry_analysis/
│   ├── config.py               # pydantic-settings，env_prefix="IA_"（含 auto_confirm_grade）
│   ├── graph/                  # SQLite DAG: models, store, 别名消歧 dedup, cycle-check
│   ├── mining/                 # expand / batch_expand / prompt builder / parser
│   ├── quantagent/client.py    # QuantAgent CLI 封装（仿 DailyAnalysis）
│   ├── review/                 # 评审状态机
│   ├── themes/                 # 种子加载
│   ├── cli/                    # typer CLI -> `ia`
│   └── dashboard/              # FastAPI app + static/ (Cytoscape.js)
├── data/graph.db               # SQLite 单一事实来源（gitignore）
└── tests/
```

---

## 12. 非目标（MVP 明确不做）

- 不批量填充公司层节点（类型保留）。
- 不实现 100 分瓶颈评分模型（`metadata` 预留字段）。
- 不接 MDS 行情、不做财务验证（后续阶段，公司层接入时再做）。
- 不做实时信号监控/定时任务（DailyAnalysis 已负责该职责）。

---

## 13. 后续阶段（MVP 之后）

1. 公司层挖掘 + 与 InvestmentWorkspace 个股 KB 打通。
2. 100 分瓶颈评分 + A–E 证据分级闸门自动化（chain-quality-checker 强制）。
3. 接入 MDS / 财务数据做"财务拐点"验证。
4. 与 DailyAnalysis 信号联动（瓶颈材料价格、出口管制、扩产等信号触发节点重挖）。
