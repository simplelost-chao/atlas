import { execFile } from "child_process";
import { promisify } from "util";
import type { z } from "zod";
import {
  ChainSkeletonSchema,
  NodeExpansionSchema,
  CompanyDiscoverySchema,
  DeepAnalysisSchema,
  ProfitChainSchema,
} from "./schemas";

const execFileAsync = promisify(execFile);

// Hardcoded JSON examples for each schema — most reliable way to guide Claude
const SCHEMA_EXAMPLES = new Map<z.ZodType, string>();

SCHEMA_EXAMPLES.set(
  ChainSkeletonSchema,
  JSON.stringify(
    {
      industryName: "行业标准名称",
      overview: "行业概述100字以内",
      nodes: [
        {
          name: "环节名称",
          description: "环节描述",
          nodeType: "DOWNSTREAM",
          order: 0,
        },
        {
          name: "环节名称2",
          description: "环节描述2",
          nodeType: "UPSTREAM",
          order: 1,
        },
      ],
    },
    null,
    2
  )
);

SCHEMA_EXAMPLES.set(
  NodeExpansionSchema,
  JSON.stringify(
    {
      parentNodeName: "父环节名称",
      subNodes: [
        {
          name: "子环节名称",
          description: "详细描述",
          nodeType: "UPSTREAM",
          order: 0,
          profitMargin: "20-30%",
          marketSize: "500亿美元",
          growthTrend: "年增长15%",
          keyDrivers: ["驱动因素1", "驱动因素2"],
        },
      ],
    },
    null,
    2
  )
);

SCHEMA_EXAMPLES.set(
  CompanyDiscoverySchema,
  JSON.stringify(
    {
      nodeName: "所属环节名称",
      companies: [
        {
          name: "公司名称",
          ticker: "TICK",
          exchange: "NASDAQ",
          isPublic: true,
          country: "美国",
          mainBusiness: "主营业务描述",
          coreProducts: ["产品1", "产品2"],
          marketPosition: "LEADER",
          marketShare: "30%",
        },
      ],
    },
    null,
    2
  )
);

SCHEMA_EXAMPLES.set(
  DeepAnalysisSchema,
  JSON.stringify(
    {
      companyName: "公司名称",
      financials: {
        marketCap: "1000亿美元",
        revenue: "500亿美元",
        revenueGrowth: "25%",
        grossMargin: "60%",
        netMargin: "30%",
        roe: "25%",
        financialTrend: {
          years: ["2022", "2023", "2024"],
          revenue: ["300亿", "400亿", "500亿"],
        },
      },
      competitive: {
        moat: "护城河分析",
        competitors: ["竞争对手1", "竞争对手2"],
      },
      investment: {
        highlights: ["亮点1", "亮点2", "亮点3"],
        risks: ["风险1", "风险2", "风险3"],
        analystRating: "买入",
        customerConcentration: "前5大客户占比40%",
      },
    },
    null,
    2
  )
);

SCHEMA_EXAMPLES.set(
  ProfitChainSchema,
  JSON.stringify(
    {
      summary: "利润链分析总结200字以内",
      nodeAnalyses: [
        {
          nodeName: "环节名称",
          profitMargin: "30%",
          valueFlow: "价值流转描述",
          profitConcentration: "HIGH",
          reason: "原因分析",
        },
      ],
      profitFlowDescription: "利润整体流向描述",
    },
    null,
    2
  )
);

/**
 * Call Claude CLI as a subprocess to generate structured JSON output.
 */
export async function generateObjectViaCLI<T extends z.ZodType>(
  {
    system,
    prompt,
    schema,
  }: {
    system?: string;
    prompt: string;
    schema: T;
  },
  retryCount = 0
): Promise<{ object: z.infer<T>; costUSD?: number; durationMs?: number }> {
  const example = SCHEMA_EXAMPLES.get(schema) ?? '{"key": "value"}';

  const fullPrompt = [
    system ?? "",
    "",
    prompt,
    "",
    "你必须严格按照以下 JSON 格式输出。不要包含任何其他文字，不要用 markdown 代码块包裹，直接输出纯 JSON。",
    "nodeType 只能是 UPSTREAM、MIDSTREAM、DOWNSTREAM 之一。",
    "marketPosition 只能是 LEADER、CHALLENGER、EMERGING、NICHE 之一。",
    "profitConcentration 只能是 HIGH、MEDIUM、LOW 之一。",
    "",
    "JSON 格式示例：",
    example,
  ]
    .join("\n")
    .trim();

  console.log(`[Claude CLI] Calling with prompt length: ${fullPrompt.length}`);

  try {
    const { stdout } = await execFileAsync(
      "claude",
      ["-p", fullPrompt, "--output-format", "json", "--allowedTools", "mcp__fetch__fetch,WebSearch"],
      {
        timeout: 180_000,
        maxBuffer: 1024 * 1024 * 10,
        env: { ...process.env },
      }
    );

    // Parse the CLI JSON wrapper
    const cliResponse = JSON.parse(stdout);
    const resultText: string = cliResponse.result;

    console.log(
      `[Claude CLI] Got response, length: ${resultText.length}, cost: $${cliResponse.total_cost_usd?.toFixed(4) ?? "?"}`
    );

    // Extract and parse JSON from the result
    const jsonStr = extractJSON(resultText);
    const parsed = parseJSONWithRepair(jsonStr);

    // Validate against schema
    const validated = schema.parse(parsed);
    return {
      object: validated,
      costUSD: cliResponse.total_cost_usd ?? 0,
      durationMs: cliResponse.duration_ms ?? 0,
    };
  } catch (error: any) {
    console.error(`[Claude CLI] Error:`, error.message);

    // On parse/validation failure, retry once with a repair prompt
    if (retryCount < 1 && (error.message.includes("JSON") || error.name === "ZodError")) {
      console.log(`[Claude CLI] Retrying with stricter prompt...`);
      return generateObjectViaCLI({ system, prompt, schema }, retryCount + 1);
    }

    if (error.name === "ZodError") {
      throw new Error(
        `Claude CLI returned invalid structure: ${error.message}`
      );
    }
    throw new Error(`Claude CLI call failed: ${error.message}`);
  }
}

/**
 * Try to parse JSON, with basic repair for common LLM output issues.
 */
function parseJSONWithRepair(jsonStr: string): any {
  // Try direct parse first
  try {
    return JSON.parse(jsonStr);
  } catch {
    // ignore, try repairs
  }

  let repaired = jsonStr;

  // Remove trailing commas before } or ]
  repaired = repaired.replace(/,\s*([\]}])/g, "$1");

  // Remove control characters that break JSON
  repaired = repaired.replace(/[\x00-\x1F\x7F]/g, (ch) => {
    if (ch === "\n" || ch === "\r" || ch === "\t") return ch;
    return "";
  });

  // Fix unescaped newlines inside strings (common LLM issue)
  // Replace literal newlines inside string values with \n
  repaired = repaired.replace(/"([^"]*?)"/g, (match) => {
    return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  });

  try {
    return JSON.parse(repaired);
  } catch {
    // ignore
  }

  // Try to fix truncated JSON by closing open brackets
  let closers = "";
  let inString = false;
  let escape = false;
  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") closers = "}" + closers;
    else if (ch === "[") closers = "]" + closers;
    else if (ch === "}" || ch === "]") closers = closers.slice(1);
  }
  if (closers) {
    try {
      return JSON.parse(repaired + closers);
    } catch {
      // ignore
    }
  }

  throw new Error(`Failed to parse JSON after repair attempts: ${jsonStr.slice(0, 200)}`);
}

/**
 * Extract JSON from a string that may contain markdown code fences.
 */
function extractJSON(text: string): string {
  // Try raw JSON first (starts with { or [)
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  // Try to extract from ```json ... ``` blocks
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Last resort: find the first { and last }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }

  throw new Error(
    `Could not extract JSON from Claude CLI response: ${text.slice(0, 200)}`
  );
}
