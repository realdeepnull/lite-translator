import { describe, expect, it, vi } from "vitest";
import {
  ERROR_CODES,
  TranslatorError,
  createTranslator,
  splitSegments,
  type LiveTranslationEvent,
  type TranslationEngine,
  type LanguagePair,
  type TranslationResult,
} from "../src/index.js";

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

/** Failing engine that rejects every translateBatch call. */
function createFailingEngine(id = "failing"): TranslationEngine {
  const engine = createMockEngine(id);
  (engine.translateBatch as ReturnType<typeof vi.fn>).mockRejectedValue(
    new Error("inference exploded"),
  );
  (engine.translate as ReturnType<typeof vi.fn>).mockRejectedValue(
    new Error("inference exploded"),
  );
  return engine;
}

/** Flushes pending timers and microtasks so debounced work settles. */
function flush(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("splitSegments", () => {
  it("splits complete sentence and partial tail", () => {
    const { complete, partial } = splitSegments("Hallo. Wie geht");
    expect(complete).toEqual(["Hallo."]);
    expect(partial).toBe("Wie geht");
  });

  it("trailing boundary leaves empty partial", () => {
    const { complete, partial } = splitSegments("Hallo. ");
    expect(complete).toEqual(["Hallo."]);
    expect(partial).toBe("");
  });

  it("newline acts as a boundary", () => {
    const { complete, partial } = splitSegments("Erste Zeile\nZweite");
    expect(complete).toEqual(["Erste Zeile"]);
    expect(partial).toBe("Zweite");
  });

  it("empty input yields no segments", () => {
    const { complete, partial } = splitSegments("");
    expect(complete).toEqual([]);
    expect(partial).toBe("");
  });

  it("multiple terminators split into multiple complete segments", () => {
    const { complete, partial } = splitSegments("Eins. Zwei! Drei?");
    expect(complete).toEqual(["Eins.", "Zwei!", "Drei?"]);
    expect(partial).toBe("");
  });
});

describe("LiveSession", () => {
  it("update fires translation after debounce", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    const onTranslation = vi.fn();
    live.on("translation", onTranslation);
    live.update("Hallo Welt");
    expect(onTranslation).not.toHaveBeenCalled();
    await flush(150);
    expect(onTranslation).toHaveBeenCalledTimes(1);
    const event = onTranslation.mock.calls[0]![0] as LiveTranslationEvent;
    expect(event.source).toBe("Hallo Welt");
    expect(event.text).toBe("[en] Hallo Welt");
    live.dispose();
  });

  it("identical consecutive input skips inference", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    const onTranslation = vi.fn();
    live.on("translation", onTranslation);
    live.update("Hallo Welt");
    await flush(150);
    const callsAfterFirst = (engine.translateBatch as ReturnType<typeof vi.fn>).mock.calls.length;
    live.update("Hallo Welt"); // identical
    await flush(150);
    const callsAfterSecond = (engine.translateBatch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst); // no new inference
    live.dispose();
  });

  it("discards outdated results (discard-by-sequence)", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    const events: LiveTranslationEvent[] = [];
    live.on("translation", (e) => events.push(e));
    live.update("a");
    live.update("ab");
    await flush(150);
    // Only the latest input should produce a result.
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("ab");
    live.dispose();
  });

  it("caches complete segments — second update only translates the partial", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    const onTranslation = vi.fn();
    live.on("translation", onTranslation);
    live.update("Hallo. Wie geht");
    await flush(150);
    const firstBatch = (engine.translateBatch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string[];
    expect(firstBatch).toContain("Hallo.");
    expect(firstBatch).toContain("Wie geht");
    // Second update: same complete sentence, different partial.
    live.update("Hallo. Mir geht es gut");
    await flush(150);
    const secondBatch = (engine.translateBatch as ReturnType<typeof vi.fn>).mock.calls[1]![0] as string[];
    expect(secondBatch).not.toContain("Hallo."); // cached, not re-translated
    expect(secondBatch).toContain("Mir geht es gut");
    live.dispose();
  });

  it("emits segments with correct completeness flags", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    const onTranslation = vi.fn();
    live.on("translation", onTranslation);
    live.update("Hallo. Welt");
    await flush(150);
    const event = onTranslation.mock.calls[0]![0] as LiveTranslationEvent;
    expect(event.segments).toHaveLength(2);
    expect(event.segments[0]!.complete).toBe(true);
    expect(event.segments[0]!.source).toBe("Hallo.");
    expect(event.segments[1]!.complete).toBe(false);
    expect(event.segments[1]!.source).toBe("Welt");
    expect(event.partial).toBe("[en] Welt");
    live.dispose();
  });

  it("empty input emits a cleared translation without inference", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    const onTranslation = vi.fn();
    live.on("translation", onTranslation);
    live.update("");
    await flush(150);
    expect(onTranslation).toHaveBeenCalledTimes(1);
    const event = onTranslation.mock.calls[0]![0] as LiveTranslationEvent;
    expect(event.text).toBe("");
    expect(event.partial).toBe("");
    expect(engine.translateBatch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    live.dispose();
  });

  it("clear() resets the cache and emits an empty translation", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    const onTranslation = vi.fn();
    live.on("translation", onTranslation);
    live.update("Hallo. Welt");
    await flush(150);
    onTranslation.mockClear();
    live.clear();
    expect(onTranslation).toHaveBeenCalledTimes(1);
    const event = onTranslation.mock.calls[0]![0] as LiveTranslationEvent;
    expect(event.text).toBe("");
    // After clear, re-translating the same text should re-translate the complete segment.
    (engine.translateBatch as ReturnType<typeof vi.fn>).mockClear();
    live.update("Hallo. Welt");
    await flush(150);
    const batch = (engine.translateBatch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string[];
    expect(batch).toContain("Hallo."); // cache was cleared
    live.dispose();
  });

  it("dispose stops pending work and emits dispose event", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    const onDispose = vi.fn();
    const onTranslation = vi.fn();
    live.on("dispose", onDispose);
    live.on("translation", onTranslation);
    live.update("Hallo Welt");
    live.dispose();
    expect(onDispose).toHaveBeenCalledTimes(1);
    await flush(150);
    expect(onTranslation).not.toHaveBeenCalled();
    expect(live.disposed).toBe(true);
  });

  it("update after dispose throws TranslatorError", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    live.dispose();
    expect(() => live.update("x")).toThrow(TranslatorError);
    expect(() => live.update("x")).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TRANSLATION_FAILED }),
    );
  });

  it("on() after dispose throws", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    live.dispose();
    expect(() => live.on("translation", () => {})).toThrow(TranslatorError);
  });

  it("propagates engine errors via the error event", async () => {
    const engine = createFailingEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession({ debounce: 50 });
    const onError = vi.fn();
    live.on("error", onError);
    live.update("Hallo Welt");
    await flush(150);
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0]![0] as TranslatorError;
    expect(err).toBeInstanceOf(TranslatorError);
    expect(err.code).toBe(ERROR_CODES.TRANSLATION_FAILED);
    live.dispose();
  });

  it("createLiveSession on a disposed translator throws", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.dispose();
    expect(() => translator.createLiveSession()).toThrow(TranslatorError);
  });

  it("uses default debounce of 250ms when no option is given", async () => {
    const engine = createMockEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const live = translator.createLiveSession();
    const onTranslation = vi.fn();
    live.on("translation", onTranslation);
    live.update("Hallo");
    // Before 250ms: no result yet.
    await flush(200);
    expect(onTranslation).not.toHaveBeenCalled();
    // After 250ms: result arrives.
    await flush(150);
    expect(onTranslation).toHaveBeenCalledTimes(1);
    live.dispose();
  });
});