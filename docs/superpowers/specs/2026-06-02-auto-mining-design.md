# 自动挖掘设计文档

**日期**: 2026-06-02  
**状态**: 已确认，待实现  
**审阅**: Codex (gpt-5.5) + Gemini (auto-gemini-3)

---

## 一、目标

在现有 `ia expand` 手动挖掘基础上，建立两种自动挖掘模式：

- **首次挖掘**：对新主题做深度全量建图（depth 3），以本地年报为证据基础
- **更新挖掘**：对已有主题做增量维护——叶节点向上游延伸（A）+ 新年报驱动重评（C）

并通过**快驱动（新闻）**和**慢驱动（宏观/定期）**自动触发更新。

---

## 二、数据层

### 2.1 数据源

| 数据源 | 路径 | 大小 | 说明 |
|---|---|---|---|
| CN filings.db | `D:/quantdata/markets/CN/filings.db` | 5.5GB | A 股年报/季报，只读源库 |
| US/filings.db | `D:/quantdata/atlas/datasource/US/filings.db` | 6.5MB | 美股 10-K，按需扩充 |
| datasource.db | `D:/quantdata/atlas/datasource/datasource.db` | 工作库 | FTS5 证据索引 |
| graph.db | `D:/quantdata/atlas/graph/graph.db` | DAG 库 | 供应链图谱 |

**CN filings.db 结构（只读）：**
- `documents`（16,139 行）：`symbol`, `doc_type`, `publish_date`, `content_hash`, `parse_status`
- `sections`（1,894,631 行）：`symbol`, `heading_path`, `section_name`, `content`, `char_count`

### 2.2 cn-extract（新命令）

```bash
ia datasource cn-extract --theme robotics    # 关键词驱动，批量
ia datasource cn-extract --symbol 300677.SZ  # 单公司，按需（同步等待）
```

**执行逻辑：**

1. 在 CN filings.db `sections` 上建 **sidecar FTS5 索引**（trigram tokenizer，支持中文）
2. FTS5 搜主题关键词 → 命中 `symbol` 列表
3. 对每个 symbol，提取以下 sections：
   - `heading_path` 含：供应商 / 原材料 / 客户 / 主营 / 采购 / 主要产品 / MD&A / 风险
   - 命中段落 ± 1 个相邻段落（保留上下文，控制 token 成本）
4. 生成**证据包**写入 datasource.db：`{symbol, doc_id, section_id, snippet, heading_path}`
   - 不复制全文，只存指针 + 摘要
5. 记录已索引集合：`{document_id, content_hash}`，支持幂等重跑

**主题关键词表**（每主题维护在 `seeds/theme_keywords.yaml`）：

```yaml
robotics:
  - 谐波减速器
  - RV减速器
  - 伺服电机
  - 工业机器人
  - 关节模组
ai-infrastructure:
  - HBM
  - CoWoS
  - 算力
  - 液冷
  - 数据中心
# ...其余主题
```

### 2.3 增量追踪

不用 `publish_date > last_run`（会漏补录/修订），改用：

```sql
SELECT symbol, document_id, content_hash
FROM cn_filings.documents
WHERE (document_id, content_hash) NOT IN already_indexed
  AND doc_type IN ('annual', 'semi-annual', 'prospectus')
  AND parse_status = 'success'
```

`already_indexed` 存在 datasource.db 的 `extract_log` 表中。

### 2.4 美股处理

- 按需触发：`expand` 发现 US-listed 公司节点时，自动 `ia datasource us-fetch --ticker <t>`
- 同步等待（同 CN 按需逻辑）
- EDGAR 风险处理：速率限制（≤10 req/s）、User-Agent 含 email、CIK 缓存、失败重试、"无证据 ≠ 不存在"状态

---

## 三、首次挖掘（`ia mine first`）

```bash
ia mine first --theme robotics [--depth 3]
```

**执行步骤：**

```
Step 1  cn-extract --theme robotics
        → FTS5 预填充 datasource.db

Step 2  ia expand <theme_id> --auto-depth 3
        每次 expand 节点时：
        ├── FTS5 搜节点别名 → 证据 snippets 注入 prompt
        ├── LLM 推断子节点，证据引用 → grade A/B/C
        └── 子节点是公司 + 无索引：
              cn-extract --symbol <ticker>（同步等待）
              索引完成 → 继续 expand（grade 用新证据）

Step 3  ia sync <chain_id> --theme robotics
        将 confirmed 节点写入 Atlas Postgres
```

**适用条件：** 主题节点存在，但 total_nodes = 0（或 < 5 个 depth-1 节点）

---

## 四、更新挖掘（`ia mine update`）

```bash
ia mine update --theme robotics [--since 2026-05-01]
ia mine update --theme all
```

### 4.1 C 分支：新年报驱动重评

```
检测新/修订文档（content_hash 变化）
→ 增量 cn-extract（仅新文档）
→ 对涉及 symbol 的已有节点重新评分 evidence_grade
→ grade 提升（D→B）→ 状态变 confirmed，加入展开候选队列
```

### 4.2 A 分支：叶节点向上游展开

```
找叶节点：suppliers=[] AND theme=T AND status=confirmed
          AND evidence_grade IN (A, B, C)
按 grade 降序排列
逐一 ia expand（depth 1）
新节点 → proposed 状态 → 进 review queue
```

### 4.3 输出摘要

```
更新摘要 (robotics, since 2026-05-01)
  新年报触发重评：12 个节点（3 个 grade 提升）
  叶节点展开：8 个新节点
  进入 review queue：8 个
  建议：ia review list
```

---

## 五、两驱动

### 5.1 快驱动（新闻信号）

```
ia news scan（每日）
  fetch_all(24h)             ← AKShare + finvizfinance + GDELT
  → keyword_filter           ← 本地过滤，~80% 噪声丢弃
  → scan(QuantAgent)         ← 批次 10 篇，提取挖掘信号
  → MiningTask → queue.add

ia queue next
  score ≥ 80 → ia expand <root_node>（自动，同步等 cn-extract）
  score < 80 → 进 review queue，等人工确认
```

### 5.2 慢驱动（定期宏观）

```
ia mine update --theme all（每周一次，或手动）
  → C 分支：检测新年报 → 重评
  → A 分支：展开高证据叶节点
```

---

## 六、PR 执行顺序

| PR | 内容 | 前置 | 优先级 |
|---|---|---|---|
| **PR 1** | `cn-extract`：CN filings.db sidecar FTS5 + 证据包写入 | 无 | 高 |
| **PR 2** | `ia mine first`：orchestrate cn-extract → expand → 按需等待 | PR 1 | 高 |
| **PR 3** | 新闻源：AKShare + finvizfinance + 关键词预过滤 | 无 | 高 |
| **PR 4** | `ia daily`：fetch → filter → scan → queue | PR 3 | 高 |
| **PR 5** | `ia mine update`（A+C）：增量 index + 叶节点展开 | PR 1+2 | 中 |
| **PR 6** | Web UI 队列管理（FastAPI dashboard 扩展） | 无 | 中 |

---

## 七、不在此设计范围内

- Atlas UI 中展示 review queue（UI 集成，后续讨论）
- CN/US 统一 schema（未来跨境 supply chain 需求时再合并）
- `ia mine update` 的自动触发调度（cron/scheduler，PR 5 后决定）
