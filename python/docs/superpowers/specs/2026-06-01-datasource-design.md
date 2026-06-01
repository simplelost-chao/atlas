# DataSource Layer 设计文档

**版本**: v1.0  
**日期**: 2026-06-01  
**状态**: 待实现  

## 1. 目标

为 IndustryAnalysis 提供一个**完全自包含的数据源层**：克隆项目、配置缓存目录、运行 worker，即可从零构建所有原始披露数据。不依赖任何外部项目（MarketData、DailyAnalysis、MDS）。

核心用途：验证产业链节点和公司的真实业务，尤其是**未上市公司**（通过招股书中的供应商/客户提及发现）。

## 2. 三文件架构

```
<cache_dir>/                 ← IA_DATASOURCE_CACHE_DIR 环境变量，默认 data/datasource/
  CN/
    filings.db               ← cn_worker 从零构建：A 股年报 + 招股书
  US/
    filings.db               ← us_worker 从零构建：美股 10-K + S-1
  datasource.db              ← index_worker 构建：companies + mentions + FTS5
```

| 文件 | 数据源 | 负责 worker |
|---|---|---|
| `CN/filings.db` | 巨潮 cninfo.com.cn（T1 官方披露平台） | `cn_worker` |
| `US/filings.db` | SEC EDGAR（美国官方监管文件，免费） | `us_worker` |
| `datasource.db` | 读取上面两个 db | `index_worker` |

两个 `filings.db` 使用**相同 schema**，connector 代码复用同一个读取器。

## 3. 模块结构

```
src/industry_analysis/datasource/
  __init__.py
  config.py          # pydantic-settings，IA_DATASOURCE_* 前缀
  store/
    __init__.py
    filings_db.py    # FilingsDB：两个 filings.db 的共用读写器
    datasource_db.py # DataSourceDB：companies + mentions + FTS5
  connectors/
    __init__.py
    base.py          # BaseConnector 接口
    cninfo.py        # 巨潮 API：列举 + 下载年报/招股书 PDF
    sec_edgar.py     # SEC EDGAR API：10-K + S-1 索引 + 文件下载
  extractor/
    __init__.py
    pdf.py           # PDF → 纯文本（pdfminer.six）
    sections.py      # 纯文本 → 章节结构（heading 识别）
    mentions.py      # 从 section content 提取公司提及
  workers/
    __init__.py
    cn_worker.py     # 构建 CN/filings.db
    us_worker.py     # 构建 US/filings.db
    index_worker.py  # 构建 datasource.db
  query.py           # 统一查询接口（供 mining engine 调用）
  cli.py             # ia datasource 子命令
```

## 4. 两个 filings.db 共用 Schema

```sql
CREATE TABLE documents (
  id           TEXT PRIMARY KEY,  -- {symbol}_{doc_type}_{period_end}
  symbol       TEXT NOT NULL,     -- A 股：600519.SH；美股：NVDA
  doc_type     TEXT NOT NULL,     -- annual / prospectus / 10-K / S-1 / q1 / h1
  period_end   TEXT,              -- YYYY-MM-DD
  report_period TEXT,             -- 展示用，如 "2025年年报"
  publish_date TEXT,
  title        TEXT,
  source_url   TEXT,              -- 原始 PDF/HTM URL
  local_path   TEXT,              -- 下载到本地的相对路径（可 NULL）
  parse_status TEXT DEFAULT 'pending',  -- pending/success/failed
  parsed_at    TEXT,
  updated_at   TEXT
);
CREATE INDEX idx_doc_symbol ON documents(symbol, doc_type, period_end);

CREATE TABLE sections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  TEXT NOT NULL REFERENCES documents(id),
  symbol       TEXT NOT NULL,
  section_seq  INTEGER DEFAULT 0,
  section_level INTEGER DEFAULT 1,
  heading_path TEXT,   -- 如 "第三节/主营业务/主要供应商"
  section_name TEXT,
  content      TEXT,
  char_count   INTEGER DEFAULT 0
);
CREATE INDEX idx_sec_document ON sections(document_id);
CREATE INDEX idx_sec_symbol ON sections(symbol);

CREATE TABLE announcements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol       TEXT NOT NULL,
  ann_type     TEXT,
  title        TEXT,
  publish_date TEXT,
  source_url   TEXT,
  full_text    TEXT,
  updated_at   TEXT
);
CREATE INDEX idx_ann_symbol ON announcements(symbol, publish_date);
```

## 5. datasource.db Schema

```sql
-- 公司注册表（上市 + 未上市，一等公民）
CREATE TABLE companies (
  id         TEXT PRIMARY KEY,  -- normalize(name) slug
  name       TEXT NOT NULL,
  name_en    TEXT,
  ticker     TEXT,              -- nullable（未上市公司无 ticker）
  exchange   TEXT,
  is_listed  INTEGER DEFAULT 0,
  country    TEXT DEFAULT 'CN',
  aliases    TEXT DEFAULT '[]', -- JSON 数组
  sources    TEXT DEFAULT '[]', -- JSON 数组，在哪些文件里被发现
  created_at TEXT
);
CREATE INDEX idx_co_ticker ON companies(ticker);

-- 文件指针（不存全文，只指向 filings.db 的 document_id）
CREATE TABLE filings (
  id           TEXT PRIMARY KEY, -- {source}:{document_id}
  company_id   TEXT REFERENCES companies(id),
  filer_name   TEXT,
  filing_type  TEXT,  -- annual/prospectus/10-K/S-1
  period_end   TEXT,
  source       TEXT,  -- cn_filings / us_filings
  source_id    TEXT,  -- filings.db 里的 document.id
  source_url   TEXT,
  indexed_at   TEXT
);

-- 结构化提及（供应商/客户/竞争对手，含未上市公司）
CREATE TABLE mentions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  filing_id       TEXT REFERENCES filings(id),
  mentioned_name  TEXT NOT NULL,  -- 原文公司名
  company_id      TEXT,           -- 解析到 companies.id（可 NULL）
  mention_type    TEXT,  -- supplier/customer/competitor/investee/other
  context         TEXT,  -- 上下文片段（~400 字）
  section_path    TEXT,
  confidence      REAL DEFAULT 1.0,
  created_at      TEXT
);
CREATE INDEX idx_mention_co ON mentions(company_id);
CREATE INDEX idx_mention_name ON mentions(mentioned_name);
CREATE INDEX idx_mention_type ON mentions(mention_type);

-- FTS5：只索引关键段落（主营业务/供应商/客户）
-- trigram tokenizer：支持中英文子串，无需分词词典
CREATE VIRTUAL TABLE search_fts USING fts5(
  filing_id UNINDEXED,
  company_id UNINDEXED,
  section_path UNINDEXED,
  content,
  tokenize = 'trigram'
);
```

## 6. 三个 Worker

### 6.1 cn_worker — 构建 CN/filings.db

**数据源**: 巨潮 cninfo.com.cn  
**公开 API**（无需账号）:
- 文件列表: `POST http://www.cninfo.com.cn/new/hisAnnouncement/query`
- PDF 下载: `http://static.cninfo.com.cn/finalpage/{date}/{cninfo_id}.PDF`

**流程**:
```
配置股票池（如 A 股全量 / 指定行业 / 指定股票）
  ↓
调用巨潮 API 列举 doc_type ∈ {annual, prospectus, h1, q1}
  ↓
跳过已有（parse_status=success）的文件
  ↓
下载 PDF → 提取文本（pdfminer.six）→ 识别章节结构
  ↓
写入 documents + sections
  ↓
并发限制：1 req/s（巨潮无官方 rate limit，保守设置）
```

**关键 section 优先级**（只提取，其余跳过）:
- 主营业务 / 业务概要 / 主要产品
- 主要客户 / 主要供应商
- 同业竞争 / 关联方

### 6.2 us_worker — 构建 US/filings.db

**数据源**: SEC EDGAR  
**公开 API**（无需账号，需 User-Agent）:
- Ticker → CIK: `https://www.sec.gov/files/company_tickers.json`
- 文件索引: `https://data.sec.gov/submissions/CIK{cik}.json`
- 全文搜索: `https://efts.sec.gov/LATEST/search-index`
- 文件下载: `https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/`

**Rate limit**: 10 req/s（SEC 官方要求），设置 0.12s 间隔

**文件类型**: 10-K（年报）+ S-1/S-1A（IPO 招股书）

**流程**:
```
配置股票池（ticker 列表）
  ↓
ticker → CIK → 拉取 filings 索引（10-K + S-1）
  ↓
下载 HTM/XBRL 文件（优先 htm，fallback txt）→ 提取纯文本
  ↓
识别章节（"Item 1. Business" / "Item 1A. Risk Factors" / "Business" section）
  ↓
写入 documents + sections（和 CN 同 schema）
```

**关键 section 优先级**:
- Item 1 Business（主营业务描述）
- Customers / Major Customers（主要客户）
- Suppliers / Supply Chain（供应商）
- Competition（竞争对手）

### 6.3 index_worker — 构建 datasource.db

**输入**: 两个 filings.db  
**流程**:
```
遍历 sections（heading_path 匹配关键段落）
  ↓
mentions.py 提取公司提及（正则 + 启发式）
  未上市公司：无 ticker → 靠 normalize(name) 匹配/新建
  ↓
写入 companies + filings 指针 + mentions
  ↓
关键段落文本写入 search_fts（FTS5 trigram 索引）
```

**未上市公司识别规则**（mentions.py）:
- 招股书"主要供应商"表：提取公司名 → `is_listed=False`
- 年报"关联方"中无 ticker 的公司
- 正则：`XX有限公司 / XX Co., Ltd.`（不在 companies 表中 → 新建）

## 7. 查询接口（query.py）

```python
class DataSourceQuery:
    def lookup_company(self, name_or_ticker: str) -> CompanyProfile | None
    # 返回：公司基本信息 + 所在文件列表 + 被提及类型统计

    def search_keyword(self, keyword: str, limit: int = 20) -> list[SearchResult]
    # FTS5 trigram 全文搜索，返回：公司 + 文件 + 上下文片段
    # 示例：search_keyword("谐波减速器") → 找到绿的谐波、HDSI 等

    def get_mentions_of(self, company_name: str, mention_type: str | None = None) -> list[Mention]
    # 反向查询：某公司被哪些文件列为供应商/客户
    # 未上市公司发现的关键入口

    def get_filing_sections(self, source: str, document_id: str,
                            heading_filter: list[str] | None = None) -> list[Section]
    # 读取原始 section（从对应 filings.db）
```

## 8. CLI（ia datasource 子命令）

```
ia datasource cn-fetch [--symbols 600519.SH 688036.SH] [--doc-types annual prospectus]
ia datasource us-fetch [--tickers NVDA AVGO AAOI] [--forms 10-K S-1]
ia datasource index [--reset]
ia datasource search <keyword> [--limit 20]
ia datasource lookup <name_or_ticker>
ia datasource mentions <company_name> [--type supplier]
ia datasource status   # 显示三个 db 的文件数/索引数/最后更新时间
```

## 9. 配置（.env）

```
IA_DATASOURCE_CACHE_DIR=data/datasource
IA_DATASOURCE_CN_FILINGS_DB=           # 留空则用 cache_dir/CN/filings.db
                                        # 可指向已有的 D:/quantdata/markets/CN/filings.db（只读）
IA_DATASOURCE_CN_RATE_LIMIT=1.0        # 秒/请求
IA_DATASOURCE_SEC_USER_AGENT=IndustryAnalysis/1.0 contact@example.com
IA_DATASOURCE_SEC_RATE_LIMIT=0.12      # 秒/请求
```

`IA_DATASOURCE_CN_FILINGS_DB` 留空时 cn_worker 自建；指向已有 db 时跳过 cn_worker 直接用（只读加速）。

## 10. 依赖

```toml
# 新增到 pyproject.toml
pdfminer.six>=20221105    # PDF 文本提取
httpx>=0.28               # HTTP 客户端（已有）
```

不引入任何来自 DailyAnalysis / MarketDataService / marketdata 的代码。

## 11. 测试策略

| 测试 | 验证意图 | DB 依赖 |
|---|---|---|
| `test_cninfo_connector` | 巨潮 API 返回解析为 document 列表 | mock HTTP |
| `test_sec_edgar_connector` | CIK 解析 + filing 索引 | mock HTTP |
| `test_pdf_extractor` | PDF 字节 → 纯文本 | 本地 fixture |
| `test_sections_parser` | 纯文本 → heading_path + content | 纯函数 |
| `test_mentions_extractor` | 供应商段落 → mentions 列表（含未上市公司）| 纯函数 |
| `test_filings_db` | documents/sections CRUD + 增量跳过 | tmp SQLite |
| `test_datasource_db` | companies + mentions + FTS5 roundtrip | tmp SQLite |
| `test_fts_trigram` | "谐波减速器" 在中文文本里可命中 | tmp SQLite |
| `test_query_lookup` | lookup_company + search_keyword + get_mentions_of | tmp SQLite |

## 12. 非目标（明确不做）

- 不接入财务数据（revenue / margin / market cap）
- 不实时爬取（workers 手动或定时触发，不是 always-on 服务）
- 不处理非披露文本（新闻、研报、社媒）
- 不修改外部 db（`IA_DATASOURCE_CN_FILINGS_DB` 指向外部时只读）
