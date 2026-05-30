# Atlas - 产业链分析与投资标的挖掘平台

## 概述

Atlas 是一个团队协作的产业链分析平台。用户输入一个行业关键词（如"AI"），系统通过 LLM 自动生成该行业的上下游产业链层级结构，深度挖掘各环节的代表性公司，并提供投研级别的公司分析。团队成员可以实时协作编辑、标注和讨论。

**域名：** atlas.zhuchao.life

## 技术栈

| 层级 | 选型 |
|------|------|
| 框架 | Next.js 15 (App Router) |
| 语言 | TypeScript |
| UI | React + Tailwind CSS |
| 可视化 | D3.js (d3.tree 布局) |
| API | tRPC |
| 数据库 | PostgreSQL + Prisma ORM |
| 实时协作 | Yjs + Hocuspocus (WebSocket) |
| LLM | Vercel AI SDK (多模型支持) |
| 认证 | NextAuth.js |
| 部署 | Vercel |

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                   Client (Browser)               │
│  Next.js App Router + React + D3.js Tree View    │
│  Yjs Client (实时协作 CRDT)                       │
└──────────────┬──────────────────┬────────────────┘
               │ tRPC / RSC       │ WebSocket
┌──────────────▼──────────────────▼────────────────┐
│              Next.js Server                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ tRPC API │ │ Yjs WS   │ │ AI Generation    │  │
│  │ Routes   │ │ Server   │ │ Pipeline         │  │
│  └────┬─────┘ └────┬─────┘ └───────┬──────────┘  │
│       │             │               │             │
│  ┌────▼─────────────▼───┐  ┌───────▼──────────┐  │
│  │   PostgreSQL          │  │ LLM Router       │  │
│  │   (Prisma ORM)        │  │ (Vercel AI SDK)  │  │
│  └───────────────────────┘  └──────────────────┘  │
└───────────────────────────────────────────────────┘
```

### 核心模块

| 模块 | 职责 |
|------|------|
| 产业链引擎 | 接收行业关键词 → 调用 LLM 生成结构化产业链 → 存储 |
| 树状图可视化 | D3.js 渲染层级树，支持展开/折叠/缩放/点击查看详情 |
| 公司数据层 | 公司档案、财务指标、竞争分析、投资评级 |
| 实时协作 | Yjs CRDT 同步，多人同时编辑产业链节点和标注 |
| 用户/团队系统 | 认证、团队管理、权限控制 |

## 数据模型

### 实体关系

```
Team ──< TeamMember >── User
  │
  └──< Project (一个行业分析)
        │
        └──< IndustryChain (产业链)
              │
              └──< ChainNode (产业环节节点)
                    │
                    ├── nodeType: UPSTREAM | MIDSTREAM | DOWNSTREAM
                    ├── level: 层级深度
                    ├── parentId: 父节点（树结构）
                    │
                    └──< Company (公司)
                          │
                          ├── basicInfo: 名称、主营、上市状态、股票代码
                          ├── financials: 市值、营收、毛利率、净利率趋势
                          ├── competitive: 市场地位、市场份额、技术壁垒
                          ├── investment: 投资亮点、风险提示、评级
                          │
                          └──< SupplyRelation (供应链关系)
                                ├── supplierId / customerId
                                ├── relationType: 供应商 | 客户 | 合作伙伴
                                └── description: 关系描述
```

### ChainNode

```
ChainNode {
  id: string (cuid)
  chainId: string
  name: string
  description: string
  nodeType: enum UPSTREAM | MIDSTREAM | DOWNSTREAM
  level: number              // 层级深度（0=终端应用，越大越上游）
  parentId: string?          // 树结构父节点
  order: number              // 同级排序
  profitMargin: string?      // 该环节典型利润率
  marketSize: string?        // 市场规模
  growthTrend: string?       // 增长趋势
  keyDrivers: string[]       // 核心驱动因素
  valueFlow: string?         // 价值如何从上游传递到下游
  createdAt: datetime
  updatedAt: datetime
}
```

### Company

```
Company {
  id: string (cuid)
  chainNodeId: string

  // 基础信息
  name: string
  ticker: string?
  exchange: string?
  isPublic: boolean
  country: string?
  mainBusiness: string
  coreProducts: string[]

  // 财务指标（投研级）
  marketCap: string?
  revenue: string?
  revenueGrowth: string?
  grossMargin: string?
  netMargin: string?
  roe: string?
  financialTrend: JSON?      // 近3-5年趋势数据

  // 竞争分析
  marketPosition: enum LEADER | CHALLENGER | EMERGING | NICHE
  marketShare: string?
  moat: string?              // 护城河/技术壁垒
  competitors: string[]

  // 投资分析
  highlights: string[]       // 投资亮点
  risks: string[]            // 风险提示
  analystRating: string?     // 综合评级
  customerConcentration: string?

  createdAt: datetime
  updatedAt: datetime
}
```

### SupplyRelation

```
SupplyRelation {
  id: string (cuid)
  supplierId: string         // Company id
  customerId: string         // Company id
  relationType: enum SUPPLIER | CUSTOMER | PARTNER
  description: string?
  createdAt: datetime
}
```

## AI 产业链生成流水线

### 五步生成流程

**Step 1 - 骨架生成：** 用户输入行业关键词，LLM 生成产业链一级结构。输出树状结构的环节列表（如 AI → 应用层/模型层/算力层/数据层/基础设施）。

**Step 2 - 环节细化：** 对每个一级环节，LLM 深入拆解子环节。可递归拆解至用户指定深度（默认 3-4 层）。各环节可并行生成。

**Step 3 - 公司挖掘：** 对每个叶子环节，LLM 挖掘代表性公司。输出公司基础信息 + 所属环节 + 竞争地位。各环节可并行。

**Step 4 - 深度分析：** 对重点公司（龙头/高关注度），生成投研级详细分析：财务趋势、壁垒、供应链关系、投资亮点、风险提示。

**Step 5 - 利润链分析：** 分析环节间利润流向、价值传递链条。谁赚最多？利润向哪里集中？为什么？

### 设计要点

- **分步生成：** 每步用独立 prompt + 结构化输出（Zod schema + `generateObject()`），质量可控
- **实时渲染：** 每步完成后即时渲染到树状图，用户可看到进度
- **并发加速：** Step 2/3 中各环节可并行，用 Promise.all 控制并发度
- **深度控制：** 用户可设定最大层级深度，避免无限拆解
- **模型路由：** 不同步骤可用不同模型（骨架用强模型，批量挖掘用性价比模型）

### LLM Router

```
LLMRouter {
  providers: Map<string, ProviderConfig>
  defaultProvider: string

  generate(prompt, schema, options?) → structured JSON

  // options 包含：
  // - provider: 指定使用哪个模型
  // - temperature: 控制创造性
  // - maxTokens: 控制输出长度
}
```

基于 Vercel AI SDK 封装，通过 `createOpenAI()` / `createAnthropic()` 等工厂函数创建 provider，统一调用接口。

## 树状图可视化

### 布局

- 使用 `d3.tree()` 布局算法，水平方向展开（根节点在左）
- React 组件封装 D3：React 管理状态，D3 负责布局计算和渲染
- 大型树使用虚拟化渲染，只渲染可视区域内的节点

### 页面布局

```
┌──────────┬──────────────────────────────────────────────┐
│ 项目列表  │  树状图主画布                                  │
│ (侧边栏)  │  - 水平展开的层级树                            │
│          │  - 节点显示环节名称和关键指标                     │
│          │  - 公司以子节点或内嵌列表形式展示                  │
│          ├──────────────────────────────────────────────│
│          │  详情面板（底部或右侧滑出）                      │
│          │  - 公司详细信息、财务数据、投资分析                │
│          │  - 团队评论和标注                               │
└──────────┴──────────────────────────────────────────────┘
```

### 交互

| 操作 | 行为 |
|------|------|
| 点击节点 | 展开/折叠子节点 |
| 点击公司 | 右侧弹出详情面板 |
| 拖拽节点 | 调整节点位置或移动到其他父节点 |
| 右键节点 | 编辑 / 删除 / AI重新生成 / 添加子节点 |
| 缩放/平移 | 鼠标滚轮缩放，拖拽画布平移 |
| 搜索 | 全局搜索公司或环节，高亮定位 |
| 筛选 | 按市场地位、利润率、上市状态等筛选 |

## 实时协作系统

### 架构：Yjs + Hocuspocus

```
多个 Yjs Client ←──WebSocket──→ Hocuspocus Server ←──→ PostgreSQL
```

Hocuspocus 嵌入 Next.js 自定义 server，无需独立部署。

### 协作数据划分

**通过 Yjs 同步（需要实时协作）：**

- `chainNodes: Y.Map` — 树结构节点的增删改、位置调整
- `companyAnnotations: Y.Map` — 公司数据的用户编辑/标注
- `comments: Y.Array` — 评论
- `awareness` — 在线状态、用户光标（选中的节点）

**通过常规 API（不需要实时）：**

- AI 生成的原始公司数据（只读，存 PostgreSQL）
- 用户认证、团队管理
- 项目元数据

### 协作体验

- 多人光标：不同用户的选中节点用不同颜色标识
- 编辑锁提示：有人正在编辑某节点时，其他人看到编辑中状态
- 团队评论：可在任意节点/公司上留言讨论
- 操作历史：支持 undo/redo，可查看谁做了什么修改

## 用户认证与团队系统

### 认证：NextAuth.js

支持的登录方式：
- Email + 密码（主要）
- GitHub OAuth
- Google OAuth

### 团队工作流

注册 → 创建团队 → 邀请成员（邮件链接） → 成员点击邀请链接 → 注册/登录 → 自动加入团队

### 权限模型

```
Team
 ├── Owner    : 全部权限 + 团队管理
 ├── Admin    : 全部权限（项目/产业链 CRUD）
 ├── Editor   : 编辑产业链、添加标注和评论
 └── Viewer   : 只读 + 评论
```

### 数据隔离

- 所有数据按 Team 隔离，查询层面强制过滤 teamId
- 用户可属于多个 Team，切换团队后看到不同项目
- 项目归属于 Team，不归属于个人

### 页面路由

```
/                          → 首页/Landing
/login, /register          → 认证
/invite/:token             → 接受邀请

/app                       → 团队 Dashboard
/app/projects              → 项目列表
/app/projects/:id          → 产业链分析（树状图主界面）
/app/projects/:id/company/:cid  → 公司详情
/app/team                  → 团队管理
/app/settings              → 设置、LLM API Key 配置
```

### API Key 管理

- LLM API Key 按团队存储，加密保存于数据库
- 支持配置多个 provider 的 key（Claude、OpenAI 等）
- 团队 Owner/Admin 可管理，普通成员不可见
