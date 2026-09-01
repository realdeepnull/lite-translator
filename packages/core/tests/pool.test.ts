import { describe, expect, it, vi } from "vitest";
import { TranslatorPool } from "../src/pool.js";
import type {
  TranslationEngine,
  LanguagePair,
  TranslationResult,
  DebugEvent,
} from "../src/index.js";

function createMockEngine(id = "onnx", pairs: string[] = ["de-en", "en-de", "fr-en"]) {
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

describe("TranslatorPool", () => {
  it("switchTo gibt den gecachten Translator bei erneutem Aufruf zurück", async () => {
    const engine = createMockEngine();
    const pool = new TranslatorPool({ engines: [engine] });
    const t1 = await pool.switchTo("de", "en");
    const t2 = await pool.switchTo("de", "en");
    expect(t2).toBe(t1);
    expect(engine.load).toHaveBeenCalledTimes(0); // load ist lazy, nicht bei create
    expect(pool.size).toBe(1);
    await pool.dispose();
  });

  it("switchTo erstellt für verschiedene Paare neue Translatoren", async () => {
    const engine = createMockEngine();
    const pool = new TranslatorPool({ engines: [engine] });
    const t1 = await pool.switchTo("de", "en");
    const t2 = await pool.switchTo("en", "de");
    expect(t2).not.toBe(t1);
    expect(pool.cachedPairs()).toEqual(["de-en", "en-de"]);
    expect(pool.size).toBe(2);
    await pool.dispose();
  });

  it("get liefert den gecachten Translator oder undefined", async () => {
    const engine = createMockEngine();
    const pool = new TranslatorPool({ engines: [engine] });
    expect(pool.get("de", "en")).toBeUndefined();
    const t = await pool.switchTo("de", "en");
    expect(pool.get("de", "en")).toBe(t);
    expect(pool.get("en", "de")).toBeUndefined();
    await pool.dispose();
  });

  it("cachedPairs liefert alle gecachten Paar-Keys", async () => {
    const engine = createMockEngine();
    const pool = new TranslatorPool({ engines: [engine] });
    await pool.switchTo("de", "en");
    await pool.switchTo("fr", "en");
    expect(pool.cachedPairs()).toEqual(["de-en", "fr-en"]);
    await pool.dispose();
  });

  it("disposePair disposet einen Translator und entfernt ihn aus dem Cache", async () => {
    const engine = createMockEngine();
    const pool = new TranslatorPool({ engines: [engine] });
    const t = await pool.switchTo("de", "en");
    await pool.disposePair("de", "en");
    expect(pool.get("de", "en")).toBeUndefined();
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(t.isReady()).toBe(false); // disposed
    await pool.dispose();
  });

  it("dispose disposet alle Translatoren und leert den Cache", async () => {
    const engine = createMockEngine();
    const pool = new TranslatorPool({ engines: [engine] });
    await pool.switchTo("de", "en");
    await pool.switchTo("en", "de");
    await pool.dispose();
    expect(pool.size).toBe(0);
    expect(engine.dispose).toHaveBeenCalledTimes(2);
  });

  it("maxSize disposet den ältesten Translator (LRU)", async () => {
    const engine = createMockEngine();
    const pool = new TranslatorPool({ engines: [engine], maxSize: 2 });
    await pool.switchTo("de", "en"); // cache: [de-en]
    await pool.switchTo("en", "de"); // cache: [de-en, en-de]
    await pool.switchTo("fr", "en"); // cache: [en-de, fr-en] — de-en evicted
    expect(pool.cachedPairs()).toEqual(["en-de", "fr-en"]);
    expect(engine.dispose).toHaveBeenCalledTimes(1); // de-en disposed
    await pool.dispose();
  });

  it("switchTo refresh die LRU-Reihenfolge bei erneutem Zugriff", async () => {
    const engine = createMockEngine();
    const pool = new TranslatorPool({ engines: [engine], maxSize: 2 });
    await pool.switchTo("de", "en"); // cache: [de-en]
    await pool.switchTo("en", "de"); // cache: [de-en, en-de]
    // Re-access de-en → moves to end: cache: [en-de, de-en]
    await pool.switchTo("de", "en");
    await pool.switchTo("fr", "en"); // evicts oldest = en-de: cache: [de-en, fr-en]
    expect(pool.cachedPairs()).toEqual(["de-en", "fr-en"]);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    await pool.dispose();
  });

  it("current liefert den zuletzt verwendeten Translator", async () => {
    const engine = createMockEngine();
    const pool = new TranslatorPool({ engines: [engine] });
    expect(pool.current()).toBeUndefined();
    await pool.switchTo("de", "en");
    expect(pool.current()).toBeDefined();
    await pool.dispose();
  });

  it("onProgress wird an createTranslator weitergereicht", async () => {
    const engine = createMockEngine();
    const onProgress = vi.fn();
    const pool = new TranslatorPool({ engines: [engine], onProgress });
    const t = await pool.switchTo("de", "en");
    await t.preload();
    const loadCalls = (engine.load as ReturnType<typeof vi.fn>).mock.calls;
    expect(typeof loadCalls[0]?.[1]).toBe("function");
    await pool.dispose();
  });

  it("onDebug wird an alle erzeugten Translatoren weitergereicht", async () => {
    const engine = createMockEngine();
    const events: DebugEvent[] = [];
    const pool = new TranslatorPool({
      engines: [engine],
      onDebug: (e) => events.push(e),
    });
    const t1 = await pool.switchTo("de", "en");
    await t1.preload();
    const t2 = await pool.switchTo("en", "de");
    await t2.preload();
    // Beide Paare emiteten load-start/load-done über denselben Callback.
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "load-start")).toHaveLength(2);
    expect(types.filter((t) => t === "load-done")).toHaveLength(2);
    const pairs = new Set(
      events
        .filter((e) => e.type === "load-done")
        .map((e) => (e.type === "load-done" ? `${e.pair.from}-${e.pair.to}` : "")),
    );
    expect(pairs.has("de-en")).toBe(true);
    expect(pairs.has("en-de")).toBe(true);
    await pool.dispose();
  });

  it("ohne engines fällt createTranslator auf getDefaultEngines zurück", async () => {
    // Wir können getDefaultEngines hier nicht leicht mocken ohne Modul-Mocking,
    // aber wir können prüfen, dass der Pool ohne engines erstellt werden kann.
    const pool = new TranslatorPool();
    expect(pool.size).toBe(0);
    expect(pool.cachedPairs()).toEqual([]);
  });
});