import { describe, expect, it, vi } from "vitest";
import {
  ERROR_CODES,
  TranslatorError,
  createTranslator,
  isTranslatorError,
  withBatchFallback,
} from "../src/index.js";
import type { TranslationEngine } from "../src/index.js";
import type { LanguagePair, TranslationResult } from "../src/index.js";

function createMockEngine(id = "onnx", pairs: string[] = ["de-en", "en-de"]) {
  const supported = new Set(pairs);
  const engine: TranslationEngine = {
    id,
    supports: (pair: LanguagePair) => supported.has(`${pair.from}-${pair.to}`),
    isCached: vi.fn(async () => true),
    load: vi.fn(async () => {}),
    translate: vi.fn(
      async (text: string, pair: LanguagePair): Promise<TranslationResult> => ({
        text: `[${pair.to}] ${text}`,
        from: pair.from,
        to: pair.to,
        engine: id,
      }),
    ),
    translateBatch: vi.fn(
      async (texts: string[], pair: LanguagePair): Promise<TranslationResult[]> =>
        texts.map((text) => ({ text: `[${pair.to}] ${text}`, from: pair.from, to: pair.to, engine: id })),
    ),
    dispose: vi.fn(async () => {}),
  };
  return engine;
}

/** Engine ohne native translateBatch-Implementierung (Legacy-Engine). */
function createLegacyMockEngine(id = "legacy", pairs: string[] = ["de-en", "en-de"]) {
  const supported = new Set(pairs);
  const engine = {
    id,
    supports: (pair: LanguagePair) => supported.has(`${pair.from}-${pair.to}`),
    isCached: vi.fn(async () => true),
    load: vi.fn(async () => {}),
    translate: vi.fn(
      async (text: string, pair: LanguagePair): Promise<TranslationResult> => ({
        text: `[${pair.to}] ${text}`,
        from: pair.from,
        to: pair.to,
        engine: id,
      }),
    ),
    dispose: vi.fn(async () => {}),
  } as unknown as TranslationEngine;
  return engine;
}

describe("createTranslator", () => {
  it("erstellt einen Translator für ein unterstütztes Paar", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    expect(translator.pair).toEqual({ from: "de", to: "en" });
    expect(translator.isReady()).toBe(false);
  });

  it("wirft LANGUAGE_PAIR_NOT_SUPPORTED für unbekannte Paare", async () => {
    const engine = createMockEngine();
    await expect(
      createTranslator({ from: "xx", to: "yy", engines: [engine] }),
    ).rejects.toMatchObject({ code: ERROR_CODES.LANGUAGE_PAIR_NOT_SUPPORTED });
  });
});

describe("Translator", () => {
  it("translate lädt lazy und liefert ein Ergebnis", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    expect(engine.load).not.toHaveBeenCalled();
    const result = await translator.translate("Hallo Welt");
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("[en] Hallo Welt");
    expect(result.engine).toBe("onnx");
    expect(translator.isReady()).toBe(true);
  });

  it("preload ist idempotent", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await Promise.all([translator.preload(), translator.preload()]);
    await translator.preload();
    expect(engine.load).toHaveBeenCalledTimes(1);
  });

  it("gibt Fortschritts-Events an onProgress weiter", async () => {
    const engine = createMockEngine();
    const onProgress = vi.fn();
    const translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [engine],
      onProgress,
    });
    await translator.preload();
    const loadCalls = (engine.load as ReturnType<typeof vi.fn>).mock.calls;
    expect(typeof loadCalls[0]?.[1]).toBe("function");
  });

  it("wrapt Engine-Fehler in TRANSLATION_FAILED", async () => {
    const engine = createMockEngine();
    (engine.translate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("boom"),
    );
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await expect(translator.translate("x")).rejects.toMatchObject({
      code: ERROR_CODES.TRANSLATION_FAILED,
    });
  });

  it("lässt TranslatorError des Engines unverändert durch", async () => {
    const engine = createMockEngine();
    (engine.translate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TranslatorError(ERROR_CODES.OFFLINE_MODEL_MISSING, "offline"),
    );
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await expect(translator.translate("x")).rejects.toMatchObject({
      code: ERROR_CODES.OFFLINE_MODEL_MISSING,
    });
  });

  it("isCached delegiert an das Engine", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await expect(translator.isCached()).resolves.toBe(true);
    expect(engine.isCached).toHaveBeenCalledWith({ from: "de", to: "en" });
  });

  it("dispose macht den Translator unbenutzbar", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.dispose();
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    await expect(translator.translate("x")).rejects.toBeInstanceOf(TranslatorError);
    await translator.dispose(); // idempotent
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("Translator.translateBatch", () => {
  it("liefert Ergebnisse in Eingabereihenfolge und triggert lazy load", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    expect(engine.load).not.toHaveBeenCalled();
    const results = await translator.translateBatch(["Hallo", "Welt", "Test"]);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.text)).toEqual(["[en] Hallo", "[en] Welt", "[en] Test"]);
    expect(results.every((r) => r.engine === "onnx" && r.from === "de" && r.to === "en")).toBe(true);
    expect(translator.isReady()).toBe(true);
  });

  it("erhält Leerstrings in der Eingabe", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const results = await translator.translateBatch(["", "Hallo", ""]);
    expect(results.map((r) => r.text)).toEqual(["[en] ", "[en] Hallo", "[en] "]);
  });

  it("akzeptiert ein leeres Eingabe-Array", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const results = await translator.translateBatch([]);
    expect(results).toEqual([]);
  });

  it("wrapt Engine-Fehler in TRANSLATION_FAILED", async () => {
    const engine = createMockEngine();
    (engine.translateBatch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("boom"),
    );
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await expect(translator.translateBatch(["x"])).rejects.toMatchObject({
      code: ERROR_CODES.TRANSLATION_FAILED,
    });
  });

  it("lässt TranslatorError des Engines unverändert durch", async () => {
    const engine = createMockEngine();
    (engine.translateBatch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TranslatorError(ERROR_CODES.OFFLINE_MODEL_MISSING, "offline"),
    );
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await expect(translator.translateBatch(["x"])).rejects.toMatchObject({
      code: ERROR_CODES.OFFLINE_MODEL_MISSING,
    });
  });

  it("wirft nach dispose", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.dispose();
    await expect(translator.translateBatch(["x"])).rejects.toBeInstanceOf(TranslatorError);
  });
});

describe("withBatchFallback", () => {
  it("gibt das Engine unverändert zurück, wenn translateBatch implementiert ist", () => {
    const engine = createMockEngine();
    expect(withBatchFallback(engine)).toBe(engine);
  });

  it("bietet einen sequenziellen Fallback für Engines ohne translateBatch", async () => {
    const legacy = createLegacyMockEngine();
    const wrapped = withBatchFallback(legacy);
    expect(typeof wrapped.translateBatch).toBe("function");
    const pair: LanguagePair = { from: "de", to: "en" };
    const results = await wrapped.translateBatch(["Hallo", "Welt"], pair);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.text)).toEqual(["[en] Hallo", "[en] Welt"]);
    expect(legacy.translate).toHaveBeenCalledTimes(2);
  });

  it("erhält die Eingabereihenfolge im Fallback", async () => {
    const legacy = createLegacyMockEngine();
    const wrapped = withBatchFallback(legacy);
    const pair: LanguagePair = { from: "de", to: "en" };
    const results = await wrapped.translateBatch(["a", "b", "c"], pair);
    expect(results.map((r) => r.text)).toEqual(["[en] a", "[en] b", "[en] c"]);
  });
});

describe("errors", () => {
  it("TranslatorError hat code und Name", () => {
    const err = new TranslatorError(ERROR_CODES.MODEL_LOAD_FAILED, "msg");
    expect(err.code).toBe("MODEL_LOAD_FAILED");
    expect(err.name).toBe("TranslatorError");
    expect(isTranslatorError(err)).toBe(true);
    expect(isTranslatorError(new Error("x"))).toBe(false);
  });
});
