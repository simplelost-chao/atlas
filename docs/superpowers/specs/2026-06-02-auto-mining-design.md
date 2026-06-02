# 自动挖掘设计文档

**日期**: 2026-06-02  
**状态**: 已确认，待实现  
**审阅**: Codex (gpt-5.5) — Gemini 网络异常未完成

---

## 一、目标

在现有 `ia expand` 手动挖掘基础上，建立两种自动挖掘模式：

- **首次挖掘**（`ia mine first`）：对新主题做深度全量建图（depth 3），以本地年报为证据基础
- **更新挖掘**（`ia mine update`）：对已有主题做增量维护——叶节点向上游延伸（A）+ 新年报驱动重评（C）

并通过**快驱动（新闻每日）**和**慢驱动（每周）**自动触发更新。

---

## 二、核心术语定义

**上游叶节点**：`suppliers(node) = []` 的 confirmed 节点，即 DAG 中尚未发现上游供应商的节点。这是"向上游延伸"的起点，不是下游终端节点。

**主题挖掘状态机**：

```
unmined   → 主题存在但 total_non_theme_nodes = 0
shallow   → 有 depth-1 节点但 < 5 个，或最大深度 < 2
mined     → depth-1 节点 ≥ 5 且最大深度 ≥ 2
stale     → mined 但最近 30 天内无新年报证据更新
```

`ia mine first` 适用：`unmined` 或 `shallow`  
`ia mine update` 适用：`mined` 或 `stale`

---

## 三、数据层

### 3.1 数据源

| 数据源 | 路径 | 大小 | 说明 |
|---|---|---|---|
| CN filings.db | `D:/quantdata/markets/CN/filings.db` | 5.5GB | A 股年报/季报，只读源库 |
| US/filings.db | `D:/quantdata/atlas/datasource/US/filings.db` | 6.5MB | 美股 10-K，按需扩充 |
| datasource.db | `D:/quantdata/atlas/datasource/datasource.db` | 工作库 | FTS5 证据索引 |
| graph.db | `D:/quantdata/atlas/graph/graph.db` | DAG 库 | 供应链图谱 |

**CN filings.db 结构（只读）：**
- `documents`（16,139 行）：`symbol`, `doc_type`, `publish_date`, `content_hash`, `parse_status`
- `sections`（1,894,631 行）：`symbol`, `heading_path`, `section_name`, `content`, `char_count`

### 3.2 cn-extract（新命令）

```bash
ia datasource cn-extract --theme robotics    # 关键词驱动，批量
ia datasource cn-extract --symbol 300677.SZ  # 单公司，按需（同步等待，最多 120s）
```

**执行逻辑：**

1. 在 CN filings.db `sections` 上建/复用 **sidecar FTS5 索引**（trigram tokenizer，支持中文）
2. FTS5 搜主题关键词 → 命中 `symbol` 列表
3. 对每个 symbol，提取以下 sections（混合召回）：
   - `heading_path` 含：供应商 / 原材料 / 客户 / 主营 / 采购 / 主要产品 / MD&A / 经营讨论 / 风险
   - 命中段落 ± 1 个相邻段落（保留上下文，控制 token 成本）
4. 生成**证据包**写入 datasource.db：`{symbol, doc_id, section_id, snippet, heading_path}`
   - 不复制全文，只存指针 + 摘要
5. 幂等记录写入 `extract_log`：`{document_id, content_hash, extractor_version}`

**幂等条件**（三字段全匹配才跳过）：
```sql
WHERE (document_id, content_hash, extractor_version) NOT IN extract_log
```
`extractor_version` = 关键词表版本 + heading filter 版本的哈希，规则升级时自动触发重建。

**旧证据失效规则**：
- content_hash 变化 → 旧 snippets 标记 `stale=true`
- 相关节点 evidence_grade 降一级（A→B, B→C, C→D）并加入重评队列
- 下次 `ia mine update` 时用新证据重评

**已知召回 tradeoff**：两步召回（关键词→symbol→heading filter）会漏掉关键词不在供应商段但公司仍相关的情况，后续可引入行业分类作补充。

### 3.3 增量追踪

```sql
SELECT symbol, document_id, content_hash
FROM cn_filings.documents
WHERE (document_id, content_hash, :extractor_version) NOT IN extract_log
  AND doc_type IN ('annual', 'semi-annual', 'prospectus')
  AND parse_status = 'success'
```

使用 `content_hash`（documents 表已有）而非 `publish_date`，可正确识别补录、重解析、修订公告。

### 3.4 美股处理

- 按需触发：`expand` 发现 US-listed 公司节点时，自动 `us-fetch --ticker <t>`，同步等待（最多 120s）
- 超时则节点标记 `evidence_pending`，grade 暂设 D，不卡住 expand 流程
- EDGAR 风险：速率限制（≤10 req/s）、User-Agent 含邮箱、CIK 缓存、失败重试、"无证据 ≠ 不存在"

---

## 四、首次挖掘（`ia mine first`）

```bash
ia mine first --theme robotics [--depth 3]
```

**适用状态**：`unmined` 或 `shallow`

```
Step 1  cn-extract --theme robotics
        → sidecar FTS5 预填充 datasource.db
        → 确保主题关键词相关公司的供应商/原材料段落已索引

Step 2  ia expand <theme_id> --auto-depth 3
        每次 expand 一个节点时：
        ├── FTS5 搜节点别名 → 证据 snippets 注入 prompt
        ├── LLM 推断子节点，须引用证据 → grade A/B/C
        └── 子节点是公司 + datasource 未索引：
              cn-extract --symbol <ticker>（同步，timeout 120s）
              成功 → 用新证据继续 expand
              超时/失败 → 节点 grade D + evidence_pending，继续 expand

Step 3  ia sync <chain_id> --theme robotics
        将 confirmed 节点写入 Atlas Postgres
```

---

## 五、更新挖掘（`ia mine update`）

```bash
ia mine update --theme robotics [--since 2026-05-01]
ia mine update --theme all
```

**适用状态**：`mined` 或 `stale`

### 5.1 C 分支：新年报驱动重评（含 downgrade）

```
检测新/修订文档（content_hash or extractor_version 变化）
→ 增量 cn-extract（仅新文档）
→ 对涉及 symbol 的已有节点重新评分：
    证据增强 → grade 提升 → 加入展开候选队列
    证据弱化 / 关系消失 → grade 降级 → 加入 review queue（人工确认）
    文档删除 / parse 失败 → 节点标 stale，等待人工审核
```

### 5.2 A 分支：上游叶节点延伸

```
找上游叶节点：
  suppliers(node) = []
  AND theme = T
  AND status = confirmed
  AND evidence_grade IN (A, B, C)

按 grade 降序排列
逐一 ia expand depth 1
新节点 → proposed 状态 → 进 review queue
```

### 5.3 输出摘要

```
更新摘要 (robotics, since 2026-05-01)
  新年报触发重评：12 个节点（3 个 grade 升 / 1 个 grade 降 → review queue）
  上游叶节点展开：8 个新节点（proposed）
  进入 review queue：9 个
  建议：ia review list
```

---

## 六、两驱动

### 6.1 快驱动（新闻信号）

```
ia news scan（每日）
  fetch_all(24h)              ← AKShare + finvizfinance + GDELT
  → keyword_filter            ← 本地过滤，~80% 噪声丢弃
  → scan(QuantAgent)          ← 批次 10 篇，提取挖掘信号
  → MiningTask → queue.add

ia queue next
  score ≥ 80 + 每日预算未超（默认 max 3 次 auto expand/日）+ 同主题无进行中 expand
    → auto: cn-extract --theme + ia expand <root_node>（同步）
  其余情况
    → 进 review queue，等人工确认
```

**每日预算 + 同主题锁**防止新闻误报引发大量自动展开。

### 6.2 慢驱动（定期宏观）

```
ia mine update --theme all（每周一次，或手动触发）
  → C 分支：检测新年报 → 双向重评（升/降）
  → A 分支：展开高证据上游叶节点
```

---

## 七、PR 执行顺序

证据生命周期优先于新闻系统（Codex 建议采纳）：

| PR | 内容 | 前置 | 优先级 |
|---|---|---|---|
| **PR 1** | `cn-extract`：sidecar FTS5 + 证据包 + extractor_version + stale 标记 | 无 | 高 |
| **PR 2** | `ia mine first`：orchestrate cn-extract → expand → timeout 兜底 | PR 1 | 高 |
| **PR 3** | `ia mine update`（A+C）：增量 index + 双向重评 + 叶节点展开 | PR 1+2 | 高 |
| **PR 4** | 新闻源：AKShare + finvizfinance + 关键词预过滤 | 无 | 中 |
| **PR 5** | `ia daily`：fetch → filter → scan → queue + 每日预算 + 主题锁 | PR 4 | 中 |
| **PR 6** | Web UI 队列管理（FastAPI dashboard 扩展） | 无 | 中 |

---

## 八、不在此设计范围内

- Atlas UI 中展示 review queue（UI 集成，后续讨论）
- CN/US 统一 schema（未来跨境 supply chain 需求时再合并）
- `ia mine update` 的自动调度（cron，PR 3 后决定）
- 行业分类作 FTS 召回补充维度（已知 limitation，后续优化）
