import { describe, it, expect } from "vitest";
import { normalize } from "@/server/lib/normalize";

describe("normalize (entity resolution key)", () => {
  it("lowercases and strips surrounding whitespace", () => {
    expect(normalize(" InP ")).toBe("inp");
    expect(normalize("inp")).toBe("inp");
    expect(normalize(" InP ")).toBe(normalize("inp"));
  });

  it("strips internal spaces and punctuation", () => {
    // WHY: an LLM may emit "Indium Phosphide", "indium-phosphide", or
    // "Indium  Phosphide"; all must collapse to one entity key.
    expect(normalize("Indium Phosphide")).toBe("indiumphosphide");
    expect(normalize("indium-phosphide")).toBe("indiumphosphide");
    expect(normalize("Indium  Phosphide")).toBe("indiumphosphide");
  });

  it("keeps CJK characters", () => {
    // WHY: Chinese names must survive normalization so A-share / CN entities
    // dedupe correctly.
    expect(normalize("磷化铟")).toBe("磷化铟");
    expect(normalize(" 磷化铟 ")).toBe("磷化铟");
    expect(normalize("圣邦股份")).toBe("圣邦股份");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(normalize("  ---  ")).toBe("");
    expect(normalize("")).toBe("");
  });

  it("distinguishes genuinely different entities", () => {
    expect(normalize("InP")).not.toBe(normalize("GaAs"));
    expect(normalize("磷化铟")).not.toBe(normalize("砷化镓"));
  });
});
