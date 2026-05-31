# Atlas — 产业链分析与投资标的挖掘平台

> Map Industries. Find Companies. Discover Value.

Atlas 是一个 AI 驱动的产业链分析平台，帮助投资者系统性地拆解行业上下游、挖掘供应链瓶颈（Chokepoint）公司、发现被低估的投资标的。

**在线访问**: [atlas.zhuchao.life](https://atlas.zhuchao.life)

## 核心理念

基于 [Serenity (@aleabitoreddit)](https://x.com/aleabitoreddit) 的供应链瓶颈投资方法论：

- **Chokepoint Theory** — 最好的投资机会不在终端产品，在控制不可替代输入的公司
- **不可替代性分析** — 如果一家公司断供，谁会受最大影响？有替代供应商吗？
- **信息不对称套利** — 市值太小被机构跳过 + 技术太深被散户忽略 = 真正的 alpha

## 功能

### 产业链拆解
- AI 自动生成行业产业链结构（上游/中游/下游）
- 支持无限层级深入挖掘
- 目录式浏览 + 树状图两种视图

### 公司挖掘
- 每个环节自动挖掘代表性公司
- Chokepoint 评估（护城河、市场地位、不可替代性）
- 投资亮点 + 风险提示 + 综合评级

### 实时金融数据
- Yahoo Finance API 接入，覆盖美股/港股/A 股/日股/韩股/欧股
- 实时市值、营收、利润率、PE、现金流、Beta 等 20+ 指标
- 每日自动更新

### 已覆盖行业
- 人工智能 (AI)
- 机器人 (Robotics)
- 自动驾驶 (Autonomous Driving)
- 新能源 (New Energy)
- 基因组学 (Genomics)
- 商业航天 (Commercial Space)

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript |
| UI | React 19 + Tailwind CSS v4 |
| 可视化 | D3.js v7 |
| API | tRPC v11 |
| 数据库 | PostgreSQL + Prisma v7 |
| LLM | Claude CLI (Anthropic) / Vercel AI SDK |
| 金融数据 | Yahoo Finance API (yahoo-finance2) |
| 实时协作 | Yjs + Hocuspocus |
| 认证 | NextAuth.js |

## 快速开始

### 前置条件

- Node.js 20+
- PostgreSQL 17+
- Claude Code CLI (`claude`)

### 安装

```bash
git clone https://github.com/simplelost-chao/atlas.git
cd atlas
npm install
```

### 配置

创建 `.env.local`：

```env
DATABASE_URL="postgresql://user@localhost:5432/atlas"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-here"
```

### 数据库初始化

```bash
npx prisma migrate dev
npx prisma db seed
```

### 启动

```bash
npm run dev:next
```

访问 http://localhost:3000，使用 `admin` / `123984` 登录。

## 项目结构

```
atlas/
├── src/
│   ├── app/                    # Next.js App Router 页面
│   │   ├── (auth)/             # 登录/注册
│   │   ├── app/                # 主应用
│   │   │   ├── projects/       # 产业列表 + 详情
│   │   │   ├── status/         # 系统状态监控
│   │   │   └── settings/       # 设置
│   │   └── api/                # API 路由
│   ├── server/
│   │   ├── ai/                 # AI 生成引擎
│   │   │   ├── pipeline.ts     # 5 步生成流水线
│   │   │   ├── prompts.ts      # Prompt 模板
│   │   │   ├── schemas.ts      # 结构化输出 Schema
│   │   │   ├── llm-router.ts   # 多模型路由
│   │   │   └── claude-cli.ts   # Claude CLI 适配层
│   │   ├── services/
│   │   │   └── market-data.ts  # Yahoo Finance 数据服务
│   │   ├── trpc/               # tRPC 路由
│   │   └── collab/             # 实时协作 (Yjs)
│   ├── components/             # React 组件
│   │   ├── tree/               # D3.js 树状图
│   │   ├── collab/             # 协作组件
│   │   ├── comments/           # 评论系统
│   │   └── ui/                 # 基础 UI 组件
│   ├── hooks/                  # React Hooks
│   └── lib/                    # 工具函数
├── scripts/                    # 运维脚本
│   ├── sync-market-data.ts     # 金融数据同步
│   ├── backfill-companies.ts   # 批量公司挖掘
│   ├── backfill-deep-analysis.ts # 批量深度分析
│   └── backup-db.sh            # 数据库备份
├── prisma/
│   ├── schema.prisma           # 数据模型
│   └── seed.ts                 # 种子数据
└── docs/                       # 设计文档
```

## AI 生成流水线

产业链数据通过 5 步流水线生成：

1. **骨架生成** — 输入行业关键词，生成一级环节结构
2. **环节细化** — 递归拆解每个环节为子环节
3. **公司挖掘** — 每个环节挖掘代表性公司（Chokepoint 优先）
4. **深度分析** — 龙头/挑战者公司的投研级分析（联网搜索最新数据）
5. **利润链分析** — 分析利润在产业链中的流向

### Claude CLI 模式

无需 API Key，直接使用 Claude Code 的认证：

```bash
# 生成产业链
npx tsx scripts/run-pipeline.ts <chainId> <industry>

# 批量公司挖掘
npx tsx scripts/backfill-companies.ts

# 深度分析（带 web search）
npx tsx scripts/backfill-deep-analysis.ts
```

## 金融数据接口

通过 Yahoo Finance API 获取上市公司实时数据：

```bash
npx tsx scripts/sync-market-data.ts
```

覆盖字段：
- 市值、股价、涨跌幅
- 营收、营收增速
- 毛利率、经营利润率、净利率
- ROE、EPS
- EBITDA、自由现金流、经营现金流
- 总现金、总负债、资产负债率、流动比率
- PE、Forward PE、PB、PEG
- Beta、总股本
- 企业价值 (EV)

支持市场：NASDAQ、NYSE、HKEX、SSE（上交所）、SZSE（深交所）、TSE（东京）、KRX（韩国）、TWSE（台湾）、XETRA（德国）、LSE（伦敦）、Euronext、SIX（瑞士）等。

## 数据备份

每日凌晨 3 点自动备份，保留 7 天：

```bash
bash scripts/backup-db.sh    # 手动备份
```

## 品牌设计

- 色板：Atlas Black #111827 / Atlas Gold #C59D5F / Atlas Green #10B981
- 字体：Inter
- 深色侧边栏 + 浅色内容区
- 几何 A 字形 Logo（5 色块拼接，金色三角点缀）

## 开发路线

- [x] 产业链自动生成（5 步流水线）
- [x] 6 个行业覆盖（AI/机器人/自动驾驶/新能源/基因组学/商业航天）
- [x] Yahoo Finance 实时金融数据接入
- [x] Chokepoint 评估体系
- [x] 目录式 + 树状图双视图
- [x] 品牌设计 + 移动端适配
- [x] 系统状态监控页
- [x] 数据库自动备份
- [ ] 四轮公司挖掘算法（AI 发散 → 数据关联扩展 → AI 审视 → 金融回填）
- [ ] 基于真实市值/营收自动计算市场地位排名
- [ ] 历史财报趋势图表
- [ ] 公司对比功能
- [ ] 投资组合追踪

## License

MIT
