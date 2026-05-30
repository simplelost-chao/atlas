import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export type LLMProviderName = "openai" | "anthropic";
export type PipelineStep = "skeleton" | "nodeExpansion" | "companyDiscovery" | "deepAnalysis" | "profitChain";

export interface LLMProvider {
  apiKey: string;
  model: string;
  baseURL?: string;
}

export interface LLMRouterConfig {
  defaultProvider: LLMProviderName;
  providers: Partial<Record<LLMProviderName, LLMProvider>>;
  stepProviderMap?: Partial<Record<PipelineStep, LLMProviderName>>;
}

const providerFactories: Record<LLMProviderName, (config: LLMProvider) => (modelId: string) => LanguageModel> = {
  openai: (config) => {
    const provider = createOpenAI({ apiKey: config.apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}) });
    return (modelId: string) => provider(modelId);
  },
  anthropic: (config) => {
    const provider = createAnthropic({ apiKey: config.apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}) });
    return (modelId: string) => provider(modelId);
  },
};

export class LLMRouter {
  private config: LLMRouterConfig;
  private modelCache: Map<string, LanguageModel> = new Map();

  constructor(config: LLMRouterConfig) { this.config = config; }

  getDefaultProvider(): LLMProviderName { return this.config.defaultProvider; }

  getModel(providerName?: LLMProviderName): LanguageModel {
    const name = providerName ?? this.config.defaultProvider;
    const providerConfig = this.config.providers[name];
    if (!providerConfig) throw new Error(`Provider '${name}' is not configured`);
    const cacheKey = `${name}:${providerConfig.model}`;
    if (this.modelCache.has(cacheKey)) return this.modelCache.get(cacheKey)!;
    const factory = providerFactories[name];
    const model = factory(providerConfig)(providerConfig.model);
    this.modelCache.set(cacheKey, model);
    return model;
  }

  getModelForStep(step: PipelineStep): LanguageModel {
    const providerName = this.config.stepProviderMap?.[step];
    return this.getModel(providerName);
  }
}

export async function createRouterFromTeamKeys(teamId: string, db: any): Promise<LLMRouter> {
  const providers: Partial<Record<LLMProviderName, LLMProvider>> = {};

  // 1. Try environment variables first
  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    providers.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
    };
  }

  // 2. Override/supplement with team DB keys
  const apiKeys = await db.apiKey.findMany({ where: { teamId } });
  for (const key of apiKeys) {
    const providerName = key.provider as LLMProviderName;
    if (providerName === "openai" || providerName === "anthropic") {
      providers[providerName] = {
        apiKey: key.encryptedKey,
        model: providerName === "openai" ? "gpt-4o" : "claude-sonnet-4-20250514",
      };
    }
  }

  const defaultProvider: LLMProviderName = providers.anthropic ? "anthropic" : "openai";
  if (Object.keys(providers).length === 0) {
    throw new Error("No API keys configured. Set ANTHROPIC_API_KEY in .env.local or add keys in Settings.");
  }
  return new LLMRouter({ defaultProvider, providers });
}
