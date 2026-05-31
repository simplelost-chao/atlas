# Atlas 四轮公司挖掘算法 (V2 设计)

> 状态：设计中，尚未实现

## 问题

V1 算法（单轮 AI 生成）存在以下问题：

1. **遗漏** — AI 一次性列举容易遗漏重要公司（如智谱、DeepSeek、MiniMax 等中国大模型公司）
2. **市场地位不准** — AI 把太多公司标为"龙头"（一个环节 5-6 个龙头），缺乏客观标准
3. **数据滞后** — AI 训练数据有截止日期，小公司/非上市公司数据旧
4. **覆盖面偏差** — 偏向英语世界公司，对中国/日韩/欧洲公司覆盖不足

## V2 四轮算法

### 第一轮：AI 供应链发散

AI 的核心价值在于发现传统行业分类发现不了的跨领域关联。

**输入**: 环节名称 + 描述
**输出**: 公司列表（允许跨行业，鼓励发现隐藏关联）

**Prompt 策略**:
- 不限制数量
- 强调发现"隐形冠军"和跨行业 chokepoint
- 要求覆盖中/美/欧/日/韩/以色列
- 区分上市/非上市

**示例**: 一家做特种气体的化工公司，传统分类在"化工行业"，但它是 AI 芯片制造的关键瓶颈 — 只有 AI 能发现这种关联。

### 第二轮：数据关联扩展

用金融数据 API 从第一轮发现的公司出发，通过数据关系扩展。

**数据源**:
- Yahoo Finance `recommendedSymbols` — 每家公司的相关推荐
- Yahoo Finance `industry` / `sector` — 同行业公司
- 已有公司的 `competitors` 字段 — 竞争对手

**逻辑**:
```
for each company in round1_results:
    related = yahoo.getRecommendedSymbols(company.ticker)
    competitors = yahoo.getCompetitors(company.ticker)
    new_companies += filter(related + competitors, not_in_existing)
```

**价值**: 数据驱动的扩展不会遗漏上市公司，覆盖面有保障。

### 第三轮：AI 二次审视

把第一轮 + 第二轮的合并结果给 AI，让它做查漏补缺。

**Prompt 策略**:
- 给出已有公司列表
- 问："以下是 [环节名] 的公司列表，你认为还遗漏了哪些重要公司？"
- 特别要求关注：未上市但估值高的公司、最近 6 个月新出现的公司、非英语世界的公司

### 第四轮：金融数据回填 + 市场地位自动排名

**数据回填**:
- 所有上市公司调用 Yahoo Finance API 拉精确数据
- 非上市公司保留 AI 估算数据，标注"估算"

**市场地位自动计算**:
```
同一环节内的上市公司，按 liveMarketCap 降序排列：
- Top 1-2 (且市值 > 第3名的 2x)  → LEADER
- Top 3-5                          → CHALLENGER
- 市值 < 环节中位数的 50%          → NICHE
- 其余                             → EMERGING

特殊规则：
- 如果一家公司市值虽小但市场份额 > 30% → 升级为 LEADER (细分垄断)
- 非上市但估值 > 环节上市公司中位数 → 标注为 "重点关注"
```

## 数据流

```
环节 → Round 1 (AI发散) → Round 2 (数据扩展) → Round 3 (AI审视) → Round 4 (金融回填+排名)
                                                                         │
                                                                         ▼
                                                                    Company 表
                                                                    (live* 字段 + 自动 marketPosition)
```

## 与 V1 的区别

| 维度 | V1 | V2 |
|------|----|----|
| 公司发现 | 单轮 AI | 四轮（AI+数据+AI+金融） |
| 覆盖面 | AI 想到什么列什么 | 数据关联扩展，不遗漏上市公司 |
| 市场地位 | AI 猜测 | 真实市值排名自动计算 |
| 财务数据 | AI 估算/搜索 | Yahoo Finance API 精确数据 |
| 跨行业发现 | 有，但不稳定 | 第一轮 AI 负责，后续轮次验证 |

## 实现计划

1. 改造 `pipeline.ts` 的 Step 3（公司挖掘）为四轮流程
2. 在 `market-data.ts` 中增加 `fetchRelatedCompanies()` 方法
3. 新增 `auto-rank.ts` 服务，根据 live 数据自动计算 marketPosition
4. 新增定时任务：每日同步金融数据 + 重新计算排名
