# 后续工作路线图（2026-06）

> 本文档记录从 IndustryAnalysis 迁移完成后，下一阶段在 **atlas-work** 中的工作方向。
> 所有代码和文档以后只在 `atlas-work/` 进行，IndustryAnalysis 仓库已归档。

---

## 一、项目整合状态（已完成）

| 项目 | 状态 |
|---|---|
| 代码迁移 `IndustryAnalysis/src` → `atlas-work/python/src` | ✅ 完成，atlas-work 为超集 |
| 数据迁移 → `D:/quantdata/atlas/` | ✅ 完成（off OneDrive） |
| `IA_DATA_ROOT` 配置变量 | ✅ 完成，`.env` 已设置 |
| `scripts/us_worker.py` 迁移 | ✅ 完成 |
| `scripts/bootstrap_filings.py` 迁移 | ✅ 完成 |
| IndustryAnalysis 标记为归档 | ✅ 完成 |

---

## 二、立即可做：MLCC 供应链挖掘验证

**目的：** 验证现有挖掘流水线在新赛道（非预设主题）上是否有效。  
MLCC（积层陶瓷电容器）2026 年上半年因 AI 服务器高频电容需求大幅扩产，是当前热点赛道。

**执行步骤：**
```bash
cd atlas-work/python

# 1. 直接从根节点展开（不依赖预设主题）
ia expand mlcc --auto-depth 3

# 预期挖掘路径：
# MLCC
# ├── 钛酸钡（BaTiO₃）基介质材料       [材料前驱体层]
# │   ├── 草酸氧钛钡                   [材料前驱体层]
# │   └── 高纯碳酸钡                   [材料前驱体层]
# ├── 电极材料（镍粉 / 铜粉）           [材料前驱体层]
# ├── 流延成型设备                      [工艺设备层]
# └── 叠层烧结设备                      [工艺设备层]

# 2. 查看挖掘结果
ia node list --type sub_industry
ia chokepoints --min-themes 1
```

**验收标准：**
- 能挖出 3 层以上 DAG 结构
- 至少 1 个节点有 A/B 级 A 股证据（风华高科/国巨/华新科）
- 卡脖子节点（草酸氧钛钡原料、高端流延设备）被识别

**如果失败（LLM 挖出无关节点或幻觉）：** 说明 news-scanner 的 agent prompt 需要针对 B2B 材料赛道调整，记录问题供后续优化。

---

## 三、新闻源扩展方案（待实现）

基于 Codex + Gemini 双重审计结论：

### 保留（已工作）
| 源 | 文件 | 说明 |
|---|---|---|
| GDELT Doc 2.0 | `fetchers/gdelt.py` | 降为 fallback，加指数退避（1→2→4→8s） |
| East Money 公告 | `fetchers/eastmoney.py` | 保留，修复 flash endpoint |
| Yahoo Finance | `fetchers/yfinance_news.py` | 保留，可升级为 yahooquery |

### 新增（待实现）

**CN — AKShare（无需 key，GitHub 官方维护）**

```python
# fetchers/akshare_news.py
import akshare as ak

def fetch_cls_telegraph(n=50):
    """财联社电报 — 最适合供应链事件信号（涨价/缺货/新合同）"""
    return ak.stock_info_global_cls()  # 返回 DataFrame: 时间/标题/内容

def fetch_em_news(keyword):
    """东财关键词新闻"""
    return ak.stock_news_em(symbol=keyword)

def fetch_jinshi_macro():
    """金十数据 — 宏观/大宗商品（影响原材料层）"""
    return ak.js_news()
```

**US — finvizfinance（无需 key，GitHub: lit26/finvizfinance）**

```python
# fetchers/finviz.py
from finvizfinance.news import News

def fetch_finviz_news():
    """Finviz 综合财经新闻，覆盖 US 供应链相关报道"""
    return News().get_news()["news"]  # list of {title, date, link, source}

def fetch_finviz_ticker(ticker):
    from finvizfinance.quote import finvizfinance
    return finvizfinance(ticker).ticker_news()
```

### 关键词预过滤（必须加，防止大量噪声进 LLM）

```python
# news/pipeline.py
SUPPLY_CHAIN_KEYWORDS = [
    # 事件型信号（高价值）
    "涨价", "缺货", "扩产", "产能", "交期", "供应紧张", "出口管制",
    "price increase", "shortage", "capacity expansion", "lead time",
    "supply chain", "bottleneck", "sanctions", "export control",
    # 赛道关键词
    "MLCC", "HBM", "CoWoS", "harmonic", "谐波减速器", "碳化硅", "SiC",
    "humanoid", "人形机器人", "算力", "数据中心", "储能",
]

def keyword_filter(articles, min_hits=1):
    """丢弃没有任何供应链关键词的文章，减少 ~80% LLM token 消耗"""
    ...
```

---

## 四、每日自动挖掘设计（讨论中）

> **用户反馈：对当前自动挖掘设计不满意，需要进一步讨论后再实现。**
> 以下为当前初步思路，待细化。

### 已确定的原则

1. **新闻只产生"候选信号"**，不直接写入 DAG。所有新节点必须经过 review queue。
2. **挖掘前必须有证据支撑**：QuantAgent expand 前先查 filings.db，无 B 级以上证据的节点标记为 grade=D，自动进 monitor 队列不展开。
3. **关键词预过滤在 LLM 之前**：每天新闻可能 200+ 条，先用本地过滤丢掉无关文章，只把 20-40 条高信噪比文章给 QuantAgent。

### 待讨论的问题

- **自动展开的触发条件**：只按分数（>=80）？还是结合节点是否在图中新出现？
- **人工确认的边界**：grade A/B 节点自动接受，grade C/D 人工审核？还是所有节点都过 review queue？
- **Atlas UI 集成**：review queue 是否要在 atlas 前端展示？如何让用户在网页上"一键展开"？
- **频率**：每天一次 vs 每小时一次？夜跑还是白天跑？
- **与 atlas TS pipeline 的关系**：Python CLI 挖的节点通过 `ia sync` 进 Postgres，atlas 前端显示——这个链路是否足够？还是需要 tRPC endpoint 直接触发？

### 当前 `ia daily` 草稿（待完善）

```
ia daily [--themes ai_chip,robotics] [--auto-expand] [--min-score 80] [--dry-run]

流程：
fetch_all(24h) → keyword_filter → scan(QuantAgent) → score → queue.add
→ if --auto-expand:
    top_tasks = queue.next(min_score=80, limit=3)
    for task in top_tasks:
        expand(task.root_node)  # 仅 grade>=B 自动接受
        queue.done(task.id)
→ print_digest
```

---

## 五、Web UI 队列管理（待实现）

在现有 FastAPI dashboard（`localhost:8300`）上增加队列页。

**后端新增 API：**
```
GET  /api/queue              列出任务（支持 status/min_score 过滤）
POST /api/queue              手动添加信号
PATCH /api/queue/{id}        更新状态
DELETE /api/queue/{id}       删除
```

**前端：** `dashboard/static/queue.html` — 纯 HTML + vanilla JS，无新框架依赖。

功能：查看队列 / 手动添加想挖掘的节点 / 标记 done/reject。

---

## 六、PR 执行顺序（修订版）

| PR | 内容 | 前置依赖 | 优先级 |
|---|---|---|---|
| **PR 1** | AKShare + finvizfinance 新闻源 + 关键词预过滤 + GDELT 退避 | 无 | 高 |
| **PR 2** | `ia daily` 命令（先实现 fetch+scan+queue，暂不自动展开） | PR 1 | 高 |
| **PR 3** | Web UI 队列管理（FastAPI dashboard 扩展） | 无 | 中 |
| **PR 4** | `ia daily` 自动展开逻辑（待设计讨论后实现） | PR 1+2 + 讨论确认 | 待定 |

---

## 七、数据文件位置（参考）

| 文件 | 路径 | 大小 | 说明 |
|---|---|---|---|
| graph.db | `D:/quantdata/atlas/graph/graph.db` | 76KB | DAG + 队列，持续增长 |
| datasource.db | `D:/quantdata/atlas/datasource/datasource.db` | 1.2GB | FTS5 + mentions |
| US filings.db | `D:/quantdata/atlas/datasource/US/filings.db` | 6.5MB | US 10-K 缓存 |
| CN filings.db | `D:/quantdata/markets/CN/filings.db` | 5.5GB | A 股年报（只读） |

配置：`atlas-work/python/.env` 中 `IA_DATA_ROOT=D:/quantdata/atlas`

