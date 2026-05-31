# Atlas 系统架构

## 整体架构

```
┌─────────────────────────────────────────────────────┐
│                  Client (Browser)                    │
│  Next.js App Router + React 19 + D3.js + Tailwind   │
└──────────────┬──────────────────┬────────────────────┘
               │ tRPC             │ WebSocket (Yjs)
┌──────────────▼──────────────────▼────────────────────┐
│                 Next.js Server                        │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │ tRPC API   │ │ Yjs/       │ │ AI Generation    │  │
│  │ Routes     │ │ Hocuspocus │ │ Pipeline         │  │
│  └─────┬──────┘ └─────┬──────┘ └────────┬─────────┘  │
│        │              │                 │             │
│  ┌─────▼──────────────▼──┐  ┌──────────▼──────────┐  │
│  │ PostgreSQL (Prisma)   │  │ Claude CLI + Yahoo   │  │
│  │                       │  │ Finance API          │  │
│  └───────────────────────┘  └─────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

## 数据模型

```
Team ──< TeamMember >── User
  │
  └──< Project (一个行业)
        │
        └──< IndustryChain
              │
              └──< ChainNode (产业环节)
                    │
                    └──< Company (公司)
                          ├── AI 分析数据 (moat, highlights, risks...)
                          └── 实时金融数据 (liveMarketCap, liveRevenue...)
```

## AI 生成流水线

```
用户输入行业关键词
        │
        ▼
┌─── Step 1: 骨架生成 ───┐
│ Claude CLI → 一级环节    │
└──────────┬───────────────┘
           ▼
┌─── Step 2: 环节细化 ───┐
│ 递归拆解子环节          │
│ 并发控制 (CLI=串行)     │
└──────────┬───────────────┘
           ▼
┌─── Step 3: 公司挖掘 ───┐
│ 每个环节发现代表性公司  │
│ Chokepoint 优先          │
└──────────┬───────────────┘
           ▼
┌─── Step 4: 深度分析 ───┐
│ Web Search 获取最新数据 │
│ 龙头+挑战者优先         │
└──────────┬───────────────┘
           ▼
┌─── Step 5: 利润链 ─────┐
│ 分析利润流向和集中度    │
└─────────────────────────┘
```

## 金融数据服务

```
Yahoo Finance API
        │
        ▼
┌─── market-data.ts ───────────┐
│                               │
│ toYahooSymbol(ticker, exchange)│
│   NASDAQ: NVDA                │
│   HKEX:   0700.HK            │
│   SSE:    600519.SS           │
│   SZSE:   000858.SZ           │
│   TSE:    6954.T              │
│   KRX:    005930.KS           │
│                               │
│ fetchQuote() → 实时行情       │
│ fetchFinancials() → 财务报表  │
└───────────────────────────────┘
        │
        ▼
Company 表 live* 字段
  liveMarketCap, liveRevenue, liveGrossMargin,
  liveNetMargin, liveRoe, liveEbitda,
  liveFreeCashflow, livePeRatio, liveBeta...
```

## 页面路由

```
/                           Landing Page (深色)
/login                      登录
/register                   注册
/app/projects               产业列表
/app/projects/[id]          产业详情 (目录/树状图)
/app/status                 系统状态监控
/app/settings               设置
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/server/ai/pipeline.ts` | 5 步生成流水线核心 |
| `src/server/ai/prompts.ts` | Serenity 框架 Prompt 模板 |
| `src/server/ai/claude-cli.ts` | Claude CLI 调用 + JSON 解析修复 |
| `src/server/services/market-data.ts` | Yahoo Finance 数据服务 |
| `src/app/app/projects/[id]/page.tsx` | 产业详情页（目录+树+公司卡片） |
| `src/components/company-panel.tsx` | Chokepoint 评估面板 |
| `scripts/sync-market-data.ts` | 批量同步实时金融数据 |
| `scripts/backfill-deep-analysis.ts` | 批量深度分析 |
