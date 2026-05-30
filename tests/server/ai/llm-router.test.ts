import { describe, it, expect } from "vitest";
import { LLMRouter } from "@/server/ai/llm-router";

describe("LLMRouter", () => {
  it("initializes with default provider", () => {
    const router = new LLMRouter({
      defaultProvider: "openai",
      providers: { openai: { apiKey: "test-key", model: "gpt-4o" } },
    });
    expect(router.getDefaultProvider()).toBe("openai");
  });

  it("returns model instance for a provider", () => {
    const router = new LLMRouter({
      defaultProvider: "openai",
      providers: {
        openai: { apiKey: "test-key", model: "gpt-4o" },
        anthropic: { apiKey: "test-key-2", model: "claude-sonnet-4-20250514" },
      },
    });
    expect(router.getModel("anthropic")).toBeDefined();
  });

  it("throws for unconfigured provider", () => {
    const router = new LLMRouter({
      defaultProvider: "openai",
      providers: { openai: { apiKey: "test-key", model: "gpt-4o" } },
    });
    expect(() => router.getModel("anthropic")).toThrow("Provider 'anthropic' is not configured");
  });

  it("supports step-to-provider mapping", () => {
    const router = new LLMRouter({
      defaultProvider: "openai",
      providers: {
        openai: { apiKey: "test-key", model: "gpt-4o" },
        anthropic: { apiKey: "test-key-2", model: "claude-sonnet-4-20250514" },
      },
      stepProviderMap: { skeleton: "anthropic" },
    });
    expect(router.getModelForStep("skeleton")).toBeDefined();
  });
});
