import { describe, expect, it } from "vitest";
import { createStaticRegistry, languagePairKey, parseLanguagePairKey } from "../src/index.js";

describe("languagePairKey / parseLanguagePairKey", () => {
  it("bildet Paare auf Keys ab", () => {
    expect(languagePairKey({ from: "de", to: "en" })).toBe("de-en");
    expect(parseLanguagePairKey("de-en")).toEqual({ from: "de", to: "en" });
  });

  it("wirft bei ungültigen Keys", () => {
    expect(() => parseLanguagePairKey("deen")).toThrow();
    expect(() => parseLanguagePairKey("-en")).toThrow();
    expect(() => parseLanguagePairKey("de-")).toThrow();
  });
});

describe("createStaticRegistry", () => {
  it("liefert Modelle pro Paar", async () => {
    const registry = createStaticRegistry({
      "de-en": {
        id: "tiny-de-en-v1",
        version: "1.0.0",
        engine: "onnx",
        files: [],
      },
    });
    const hit = await registry.getModel({ from: "de", to: "en" });
    expect(hit?.id).toBe("tiny-de-en-v1");
    const miss = await registry.getModel({ from: "en", to: "de" });
    expect(miss).toBeUndefined();
  });
});
