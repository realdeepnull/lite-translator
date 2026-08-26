import { describe, expect, it, vi } from "vitest";
import {
  ERROR_CODES,
  TranslatorError,
  createTranslator,
  isTranslatorError,
  withBatchFallback,
  TranslationStore,
} from "../src/index.js";
import type { TranslationEngine, TranslationCapabilities, DebugEvent } from "../src/index.js";
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

describe("Translator.t (i18n-style)", () => {
  it("t(key, text) registriert und liefert den Originaltext synchron", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    expect(t("title", "Willkommen")).toBe("Willkommen");
    expect(t("title")).toBe("Willkommen");
  });

  it("t(key) ohne Registrierung liefert den Key als Fallback", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    expect(t("missing.key")).toBe("missing.key");
  });

  it("store() ist undefined bevor t() aufgerufen wurde", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    expect(translator.store()).toBeUndefined();
    translator.t();
    expect(translator.store()).toBeInstanceOf(TranslationStore);
  });
});

describe("Translator.translateAll", () => {
  it("ruft translateBatch genau einmal für mehrere Registrierungen", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    t("header.title", "Willkommen");
    t("header.subtitle", "Bitte wählen");
    t("footer.button", "Bestätigen");
    await translator.translateAll();
    expect(engine.translateBatch).toHaveBeenCalledTimes(1);
  });

  it("übersetzt registrierte Keys und aktualisiert den Store", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    t("title", "Willkommen");
    t("button", "Bestätigen");
    await translator.translateAll();
    expect(t("title")).toBe("[en] Willkommen");
    expect(t("button")).toBe("[en] Bestätigen");
  });

  it("dedupliziert identische Werte zu einem Inference-Aufruf", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    t("a", "Abbrechen");
    t("b", "Abbrechen");
    t("c", "Abbrechen");
    await translator.translateAll();
    // Engine bekommt nur den einen eindeutigen Wert
    expect(engine.translateBatch).toHaveBeenCalledTimes(1);
    const calledTexts = (engine.translateBatch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(calledTexts).toEqual(["Abbrechen"]);
    // Alle drei Keys erhalten dieselbe Übersetzung
    expect(t("a")).toBe("[en] Abbrechen");
    expect(t("b")).toBe("[en] Abbrechen");
    expect(t("c")).toBe("[en] Abbrechen");
  });

  it("lädt das Modell lazy beim ersten translateAll", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    t("title", "Hallo");
    expect(engine.load).not.toHaveBeenCalled();
    await translator.translateAll();
    expect(engine.load).toHaveBeenCalledTimes(1);
  });

  it("ist ein No-op ohne registrierte Strings und ruft die Engine nicht auf", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    translator.t(); // Store erstellen, aber nichts registriert
    await translator.translateAll();
    expect(engine.translateBatch).not.toHaveBeenCalled();
  });

  it("benachrichtigt Subscriber nach der Übersetzung (reaktiver Update)", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    t("title", "Hallo");
    const store = translator.store()!;
    const listener = vi.fn();
    store.subscribe(listener);
    await translator.translateAll();
    // register (1) + translateAll set (1)
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("lässt Leerstrings unverändert durch (Engine-Verhalten)", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    t("empty", "");
    await translator.translateAll();
    expect(t("empty")).toBe("[en] ");
  });

  it("wrapt Engine-Fehler in TRANSLATION_FAILED", async () => {
    const engine = createMockEngine();
    (engine.translateBatch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("boom"),
    );
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    t("title", "Hallo");
    await expect(translator.translateAll()).rejects.toMatchObject({
      code: ERROR_CODES.TRANSLATION_FAILED,
    });
  });

  it("lässt TranslatorError des Engines unverändert durch", async () => {
    const engine = createMockEngine();
    (engine.translateBatch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TranslatorError(ERROR_CODES.OFFLINE_MODEL_MISSING, "offline"),
    );
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    t("title", "Hallo");
    await expect(translator.translateAll()).rejects.toMatchObject({
      code: ERROR_CODES.OFFLINE_MODEL_MISSING,
    });
  });

  it("wirft nach dispose", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    t("title", "Hallo");
    await translator.dispose();
    await expect(translator.translateAll()).rejects.toBeInstanceOf(TranslatorError);
  });

  it("t() nach dispose wirft", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    translator.t();
    await translator.dispose();
    expect(() => translator.t()("a", "b")).toThrow(TranslatorError);
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

describe("Translator AbortSignal (F6)", () => {
  it("translate wirft TRANSLATION_FAILED bei bereits abgebrochenem Signal", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      translator.translate("Hallo", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: ERROR_CODES.TRANSLATION_FAILED });
    // Engine sollte nicht aufgerufen worden sein
    expect(engine.translate).not.toHaveBeenCalled();
  });

  it("translateBatch wirft TRANSLATION_FAILED bei bereits abgebrochenem Signal", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      translator.translateBatch(["a", "b"], { signal: controller.signal }),
    ).rejects.toMatchObject({ code: ERROR_CODES.TRANSLATION_FAILED });
    expect(engine.translateBatch).not.toHaveBeenCalled();
  });

  it("translateAll wirft TRANSLATION_FAILED bei bereits abgebrochenem Signal", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const t = translator.t();
    t("title", "Hallo");
    const controller = new AbortController();
    controller.abort();
    await expect(
      translator.translateAll({ signal: controller.signal }),
    ).rejects.toMatchObject({ code: ERROR_CODES.TRANSLATION_FAILED });
    expect(engine.translateBatch).not.toHaveBeenCalled();
  });

  it("translate ohne Signal funktioniert wie bisher", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const result = await translator.translate("Hallo");
    expect(result.text).toBe("[en] Hallo");
  });

  it("translate mit nicht-abgebrochenem Signal funktioniert", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const controller = new AbortController();
    const result = await translator.translate("Hallo", { signal: controller.signal });
    expect(result.text).toBe("[en] Hallo");
  });

  it("translate wirft bei Mid-Flight-Abort, wenn die Engine das Signal auswertet", async () => {
    // Mock-Engine, die das Signal auswertet und bei Abort rejectet.
    // Der Abort passiert während des preload()-Microtasks, sodass das Signal
    // bereits abgebrochen ist, wenn engine.translate() aufgerufen wird.
    const controller = new AbortController();
    const engine: TranslationEngine = {
      ...createMockEngine(),
      translate: vi.fn(
        (_text: string, _pair: LanguagePair, options?: { signal?: AbortSignal }): Promise<TranslationResult> => {
          if (options?.signal?.aborted) {
            return Promise.reject(
              new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Translation aborted"),
            );
          }
          return new Promise<TranslationResult>(() => {
            // Never resolves; only rejects on abort (but signal is already aborted above).
          });
        },
      ),
    };
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const promise = translator.translate("Hallo", { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: ERROR_CODES.TRANSLATION_FAILED });
  });
});

describe("Translator onDebug (DX — debug events)", () => {
  it("emits load-start and load-done on preload()", async () => {
    const engine = createMockEngine();
    const events: DebugEvent[] = [];
    const translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [engine],
      onDebug: (e) => events.push(e),
    });
    await translator.preload();
    const types = events.map((e) => e.type);
    expect(types).toContain("load-start");
    expect(types).toContain("load-done");
    const loadDone = events.find((e) => e.type === "load-done");
    expect(loadDone?.type).toBe("load-done");
    if (loadDone?.type === "load-done") {
      expect(loadDone.durationMs).toBeGreaterThanOrEqual(0);
      expect(loadDone.pair).toEqual({ from: "de", to: "en" });
    }
  });

  it("emits translate-start and translate-done on translate()", async () => {
    const engine = createMockEngine();
    const events: DebugEvent[] = [];
    const translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [engine],
      onDebug: (e) => events.push(e),
    });
    await translator.translate("Hallo Welt");
    const types = events.map((e) => e.type);
    expect(types).toContain("translate-start");
    expect(types).toContain("translate-done");
    const done = events.find((e) => e.type === "translate-done");
    if (done?.type === "translate-done") {
      expect(done.inputLength).toBe("Hallo Welt".length);
      expect(done.outputLength).toBe("[en] Hallo Welt".length);
      expect(done.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("emits batch-start and batch-done on translateBatch()", async () => {
    const engine = createMockEngine();
    const events: DebugEvent[] = [];
    const translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [engine],
      onDebug: (e) => events.push(e),
    });
    await translator.translateBatch(["a", "b", "c"]);
    const start = events.find((e) => e.type === "batch-start");
    const done = events.find((e) => e.type === "batch-done");
    if (start?.type === "batch-start") expect(start.batchSize).toBe(3);
    if (done?.type === "batch-done") {
      expect(done.batchSize).toBe(3);
      expect(done.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("emits translateall-start and translateall-done on translateAll()", async () => {
    const engine = createMockEngine();
    const events: DebugEvent[] = [];
    const translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [engine],
      onDebug: (e) => events.push(e),
    });
    const t = translator.t();
    t("a", "Hallo");
    t("b", "Welt");
    t("c", "Hallo"); // duplicate of "a"
    await translator.translateAll();
    const start = events.find((e) => e.type === "translateall-start");
    const done = events.find((e) => e.type === "translateall-done");
    if (start?.type === "translateall-start") expect(start.keyCount).toBe(3);
    if (done?.type === "translateall-done") {
      expect(done.keyCount).toBe(3);
      expect(done.uniqueCount).toBe(2); // "Hallo" + "Welt" dedup
      expect(done.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("emits abort when signal is already aborted", async () => {
    const engine = createMockEngine();
    const events: DebugEvent[] = [];
    const translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [engine],
      onDebug: (e) => events.push(e),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      translator.translate("x", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: ERROR_CODES.TRANSLATION_FAILED });
    expect(events.some((e) => e.type === "abort")).toBe(true);
  });

  it("does not emit debug events when onDebug is absent", async () => {
    const engine = createMockEngine();
    // No onDebug — should not throw or produce any side effects.
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.preload();
    await translator.translate("Hallo");
    // Just verifying no errors thrown — there's nothing to assert on.
    expect(translator.isReady()).toBe(true);
  });

  it("passes onDebug to engine.load()", async () => {
    const engine = createMockEngine();
    const events: DebugEvent[] = [];
    const translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [engine],
      onDebug: (e) => events.push(e),
    });
    await translator.preload();
    // engine.load should have been called with 3 args (pair, onProgress, onDebug)
    const loadCall = (engine.load as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(loadCall?.[2]).toBeInstanceOf(Function);
  });
});

describe("Translator capabilities (DX)", () => {
  it("delegates to engine.capabilities() when implemented", async () => {
    const caps: TranslationCapabilities = {
      engine: "onnx",
      device: "wasm",
      dtype: "bnb4",
      modelId: "opus-mt-de-en",
    };
    const engine = createMockEngine();
    engine.capabilities = vi.fn(() => caps);
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    expect(translator.capabilities()).toEqual(caps);
    expect(engine.capabilities).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when engine does not implement capabilities()", async () => {
    const engine = createMockEngine();
    // engine has no capabilities() method
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    expect(translator.capabilities()).toBeUndefined();
  });
});

describe("Translator removeModel (DX — cache management)", () => {
  it("delegates to engine.removeModel() when implemented", async () => {
    const engine = createMockEngine();
    engine.removeModel = vi.fn(async () => {});
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.removeModel();
    expect(engine.removeModel).toHaveBeenCalledTimes(1);
    expect(engine.removeModel).toHaveBeenCalledWith({ from: "de", to: "en" });
  });

  it("throws ENGINE_NOT_SUPPORTED when engine does not implement removeModel()", async () => {
    const engine = createMockEngine();
    // engine has no removeModel() method
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await expect(translator.removeModel()).rejects.toMatchObject({
      code: ERROR_CODES.ENGINE_NOT_SUPPORTED,
    });
  });

  it("resets ready state so a subsequent preload re-downloads", async () => {
    const engine = createMockEngine();
    engine.removeModel = vi.fn(async () => {});
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.preload();
    expect(translator.isReady()).toBe(true);
    expect(engine.load).toHaveBeenCalledTimes(1);
    await translator.removeModel();
    expect(translator.isReady()).toBe(false);
    await translator.preload();
    expect(engine.load).toHaveBeenCalledTimes(2);
  });

  it("throws after dispose", async () => {
    const engine = createMockEngine();
    engine.removeModel = vi.fn(async () => {});
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.dispose();
    await expect(translator.removeModel()).rejects.toBeInstanceOf(TranslatorError);
  });
});
