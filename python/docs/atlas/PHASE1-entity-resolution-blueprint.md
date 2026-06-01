# Phase 1 蓝图：把实体消歧并入 atlas

**目的**: 把 IndustryAnalysis 已验证的实体消歧逻辑，移植为 atlas 的 TS/Prisma 实现。本文是给 atlas `feat/entity-resolution` PR 的施工图。
**参考实现（已测）**: IndustryAnalysis `src/industry_analysis/graph/models.py` (`normalize`)、`graph/store.py` (`find_by_name`)、`mining/engine.py` (`expand` 的 skip/link/create 三分支 + 幂等)。
**对应测试（规格）**: `tests/test_store_dedup.py`、`tests/test_mining_engine.py`。

---

## 0. 要解决的具体问题（atlas 现状）

读源码确认的三个去重缺口：

1. `src/server/ai/pipeline.ts:183` — `runNodeExpansionStep` 子环节直接 `create`，无查重。
2. `src/server/ai/pipeline.ts:242` — `runCompanyDiscoveryStep` 公司直接 `create`，无查重。
3. `src/server/ai/discovery-v2.ts:369` — `discoverCompaniesV2` 的查重是 `name.toLowerCase()` / `ticker.toUpperCase()`，**仅限单个 node 内**，无规范化、无别名、无跨 node/跨行业。

后果："磷化铟" / "InP" / "Indium Phosphide" 会变成三个节点；同一公司在不同环节/行业重复；跨行业 chokepoint 无法识别。

---

## 1. 规范化函数（移植 `normalize()`）

我们的 Python（已测）:
```python
def normalize(name: str) -> str:
    return re.sub(r"[^0-9a-z一-鿿]", "", name.lower())
```
小写化、去掉所有非字母数字（含空格/标点），**保留 CJK**。`" InP "`、`"inp"` → `"inp"`；`"Indium Phosphide"` → `"indiumphosphide"`；`"磷化铟"` 原样保留。

TS 等价（建议放 `src/server/lib/normalize.ts`）:
```ts
/** Lowercase, strip all non-alphanumeric (incl. spaces/punct), keep CJK. */
export function normalize(name: string): string {
  return name.toLowerCase().replace(/[^0-9a-z一-鿿]/g, "");
}
```
> CJK 范围：Python 的 `一-鿿` 对应 U+4E00–U+9FFF，TS 写作 `一-鿿`。注意 JS 的 `toLowerCase` 对 ASCII 行为一致；若未来要覆盖扩展 CJK（U+3400+）可再扩范围，MVP 用 BMP 主区即可。

附带单测（移植我们的 `test_normalize_collapses_variants`）:
```ts
expect(normalize(" InP ")).toBe("inp");
expect(normalize("inp")).toBe("inp");
expect(normalize("Indium Phosphide")).toBe("indiumphosphide");
expect(normalize("磷化铟")).toBe("磷化铟");
```

---

## 2. Prisma schema 改动（加列，非破坏性）

给 `ChainNode` 和 `Company` 各加 `aliases` + `normKey`：

```prisma
model ChainNode {
  // ... 现有字段不动 ...
  aliases  String[] @default([])
  normKey  String   @default("")
  @@index([normKey])
}

model Company {
  // ... 现有字段不动 ...
  aliases  String[] @default([])
  normKey  String   @default("")
  @@index([normKey])
}
```

Migration（新增，不改现有数据结构）:
```bash
npx prisma migrate dev --name add_entity_resolution_fields
```

**回填存量数据**（一次性脚本 `scripts/backfill-normkey.ts`）:
```ts
// 对所有现有 ChainNode/Company：normKey = normalize(name_en ?? name)
// company 用 name；node 用 name。别名留空，靠后续挖掘累积。
for (const n of await db.chainNode.findMany()) {
  await db.chainNode.update({ where: { id: n.id }, data: { normKey: normalize(n.name) } });
}
// Company 同理
```

> 说明：atlas 的 ChainNode 只有单一 `name`（无 name_cn/name_en 之分），Company 有 `name`。`normKey` 取 `normalize(name)` 即可；`aliases` 作为额外匹配键，由挖掘过程或人工补充。

---

## 3. find-or-link 查询（移植 `find_by_name`）

我们的 Python（已测，按规范名 + 别名集合匹配）:
```python
def find_by_name(self, name):
    key = normalize(name)
    if not key: return None
    for n in self.list_nodes():
        if any(normalize(x) == key for x in n.all_names()):  # name_cn,name_en,*aliases
            return n
    return None
```

TS 等价（建议放 `src/server/services/entity-resolution.ts`）。用 `normKey` 列直接查（比全表扫描高效），别名用数组包含：
```ts
import type { PrismaClient } from "@prisma/client";
import { normalize } from "../lib/normalize";

/** Find an existing ChainNode whose name or any alias normalizes to the same key.
 *  Scope can be the whole DB (cross-industry) or limited to a chain. */
export async function findNodeByName(
  db: PrismaClient,
  name: string,
  opts?: { chainId?: string }
): Promise<{ id: string } | null> {
  const key = normalize(name);
  if (!key) return null;
  // primary: normKey exact match
  const byKey = await db.chainNode.findFirst({
    where: { normKey: key, ...(opts?.chainId ? { chainId: opts.chainId } : {}) },
    select: { id: true },
  });
  if (byKey) return byKey;
  // secondary: alias contains the raw name (cheap pre-filter), then normalize-compare in JS
  const candidates = await db.chainNode.findMany({
    where: { aliases: { has: name }, ...(opts?.chainId ? { chainId: opts.chainId } : {}) },
    select: { id: true, aliases: true },
  });
  for (const c of candidates) {
    if (c.aliases.some((a) => normalize(a) === key)) return c;
  }
  return null;
}
```
> **设计选择 — 跨行业 vs 单链 scope**：传 `chainId` 限制在单条产业链内查重（保守，先不改变 atlas 的 per-Project 隔离语义）；不传则全库查重（激进，直接支持跨行业共享，但需配合 Phase 2 的多 Project 归属才完整）。**Phase 1 建议先用 `chainId` scope**，把"全库查重 → 跨行业共享"留给 Phase 2，降低单次 PR 风险。

公司版本 `findCompanyByName` 同理，外加 ticker 匹配（atlas 已有 ticker 维度，保留并增强）:
```ts
export async function findCompanyByTickerOrName(
  db: PrismaClient, name: string, ticker?: string
): Promise<{ id: string } | null> {
  if (ticker) {
    const byTicker = await db.company.findFirst({
      where: { ticker: { equals: ticker, mode: "insensitive" } }, select: { id: true },
    });
    if (byTicker) return byTicker;
  }
  const key = normalize(name);
  if (!key) return null;
  return db.company.findFirst({ where: { normKey: key }, select: { id: true } });
}
```

---

## 4. 改造写入路径为 find-or-create（移植 expand 的三分支）

我们的 Python `expand` 对每个候选做：(a) 命中已有子节点 → skip；(b) 命中图中其它已有节点 → 连边/合并，不新建；(c) 全新 → create。atlas 的对应改造：

### 4.1 `pipeline.ts` `runNodeExpansionStep`（line ~183）
现状直接 create。改为：
```ts
for (const subNode of object.subNodes) {
  const key = normalize(subNode.name);
  const existing = await findNodeByName(ctx.db, subNode.name, { chainId: ctx.chainId });
  if (existing) {
    // 已存在：Phase 1 先 skip（避免重复）；Phase 2 起改为加 ChainEdge 连边
    // 可选：把 subNode.name 补进 existing.aliases（若不同写法）
    continue;
  }
  await ctx.db.chainNode.create({
    data: {
      chainId: ctx.chainId, parentId: parentNode.id,
      name: subNode.name, normKey: key, aliases: [],
      description: subNode.description, nodeType: subNode.nodeType,
      level: parentNode.level + 1, order: subNode.order,
      profitMargin: subNode.profitMargin, marketSize: subNode.marketSize,
      growthTrend: subNode.growthTrend, keyDrivers: subNode.keyDrivers ?? [],
    },
  });
}
```

### 4.2 `pipeline.ts` `runCompanyDiscoveryStep`（line ~242）与 `discovery-v2.ts` 各 round
把所有 `db.company.create` 前置一个 `findCompanyByTickerOrName` 检查；命中则 skip（或补别名），未命中才 create，并写入 `normKey`。这统一替换 `discovery-v2.ts:369-372` 那套仅限单 node、无规范化的 `existingNames`/`existingTickers` Set 逻辑——改为跨 node 的持久化查重。

### 4.3 别名累积（可选增强）
当 `findNodeByName` 命中但 `subNode.name` 写法与已有 `name`/`aliases` 都不同（normalize 相等但原文不同，例如已有"InP"、新来"磷化铟"且 normalize 后…实际不等——见下注），把新写法 push 进 `aliases`，让未来匹配更稳。
> 注意：normalize 后相等才算同一实体；"InP" 与 "磷化铟" normalize 后**不相等**（一个是 ascii，一个是 CJK），靠 LLM 在挖掘时主动产出 `aliases:["InP","磷化铟","Indium Phosphide"]` 来桥接——这正是我们 chain-miner prompt 里要求输出 aliases 的原因。atlas 的 prompt（`prompts.ts`）需相应增加"为关键环节给出中英文/化学式/代号别名"的要求。

---

## 5. prompt 改动（让 LLM 产出别名）

atlas `src/server/ai/prompts.ts` 的 `nodeExpansionPrompt` 和 `companyDiscoveryPrompt`，以及 schema（`schemas.ts`）需要新增 `aliases` 字段，要求模型为可能跨主题复用的关键环节/公司给出别名（中英文、化学式、代号）。参考我们 `.quantagent/agents/chain-miner.md` 的措辞：
> "对可能跨主题复用的关键环节，给出 aliases（中英文、化学式、代号），便于跨产业链去重。"

`schemas.ts` 的 `NodeExpansionSchema.subNodes[]` 和 `CompanyDiscoverySchema.companies[]` 各加：
```ts
aliases: z.array(z.string()).default([]),
```

---

## 6. 测试（移植我们的规格测试到 atlas 的 vitest）

atlas 用 vitest。移植两组：

1. `tests/normalize.test.ts` — 第 1 节的断言。
2. `tests/entity-resolution.test.ts` — 移植 `test_store_dedup.py` + `test_mining_engine.py` 的意图：
   - 同 normKey 的两个候选只建一个节点（跨 node 查重）。
   - 别名命中 → 不新建（用 mock PrismaClient 或测试库）。
   - 重复挖掘同一环节幂等（第二次 0 新建）。

> 若 atlas 测试不便接真实 PG，可用 `vitest` + 一个内存 Prisma mock，或 testcontainers 起临时 PG。建议至少把 `normalize` 做纯函数单测（无依赖，必过）。

---

## 7. PR 拆分建议（降低单次评审负担）

| PR | 内容 | 依赖 |
|---|---|---|
| PR-1 | `normalize.ts` + 纯函数单测 | 无 |
| PR-2 | Prisma 加 `aliases`/`normKey` + migration + 回填脚本 | PR-1 |
| PR-3 | `entity-resolution.ts`（findNodeByName / findCompanyByTickerOrName）+ 测试 | PR-2 |
| PR-4 | 改造 pipeline.ts + discovery-v2.ts 写入路径为 find-or-create | PR-3 |
| PR-5 | prompts.ts + schemas.ts 增加 aliases 输出 | PR-4 |

PR-1/PR-2 风险极低、可立即合并；PR-4 是行为变更核心，需 atlas 作者重点 review。

---

## 8. 验收标准（Phase 1 完成的定义）

- 在同一条 chain 内，两次生成或 discovery-v2 四轮，**不再产生 normalize 相等的重复节点/公司**。
- LLM 输出的 `aliases` 被持久化，后续挖掘命中别名即复用。
- 现有数据经回填脚本补齐 `normKey`，UI 无回归。
- `normalize` 单测 + entity-resolution 测试通过。
- （为 Phase 2 铺路）find-or-link 的 scope 参数已就位，去掉 `chainId` 即可切换到全库/跨行业查重。
