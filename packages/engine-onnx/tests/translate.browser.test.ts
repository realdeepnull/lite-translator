import { describe, expect, it } from "vitest";
import {
  createTranslator,
  type ProgressEvent,
  type DebugEvent,
  type TranslationCapabilities,
} from "@lite-translator/core";
import { createOnnxEngine, detectWebGpu } from "../src/index.js";

/**
 * Browser integration test: loads a (quantized) OPUS-MT model from the
 * HF Hub and performs a real translation. It fails under network/CI restrictions
 * Test fehl — er ist bewusst kein Unit-Test.
 */

/** True when a real WebGPU adapter is available (async probe, not just the API). */
const webgpuAvailable =
  typeof navigator !== "undefined" && "gpu" in navigator
    ? await detectWebGpu().catch(() => false)
    : false;
describe("TransformersEngine (Browser)", () => {
  it("übersetzt 'Hallo Welt' von de nach en", async () => {
    const engine = createOnnxEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });

    const progressEvents: Array<{ phase: string; progress: number }> = [];
    const withProgress = await createTranslator({
      from: "de",
      to: "en",
      engines: [createOnnxEngine()],
      onProgress: (e) => progressEvents.push({ phase: e.phase, progress: e.progress }),
    });
    await withProgress.preload();

    expect(translator.isReady()).toBe(false);
    const result = await translator.translate("Hallo Welt");
    expect(result.engine).toBe("onnx");
    expect(result.from).toBe("de");
    expect(result.to).toBe("en");
    const expected = /hello world/i.test(result.text)
      ? 1
      : /hello,? world/i.test(result.text)
        ? 1
        : 0;
    expect(expected).toBe(1);

    expect(translator.isReady()).toBe(true);
    await translator.dispose();
    await withProgress.dispose();
  }, 600000);

  it("meldet Download-Fortschritt", async () => {
    const events: number[] = [];
    const translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [createOnnxEngine()],
      onProgress: (e: ProgressEvent) => {
        if (Number.isFinite(e.progress)) {
          events.push(e.progress);
        }
      },
    });
    await translator.preload();
    for (const p of events) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    await translator.dispose();
  }, 600000);

  it("isCached ist nach dem Laden true", async () => {
    const engine = createOnnxEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.preload();
    // isCached basiert auf Cache Storage; der Worker schreibt die Dateien dort rein.
    await expect(translator.isCached()).resolves.toBe(true);
    await translator.dispose();
  }, 600000);

  it("übersetzt ein Batch de→en in Eingabereihenfolge", async () => {
    const engine = createOnnxEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const inputs = ["Hallo Welt", "Guten Morgen", "Wie geht es dir?"];
    const results = await translator.translateBatch(inputs);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.engine === "onnx" && r.from === "de" && r.to === "en")).toBe(true);
    // Reihenfolge muss der Eingabe entsprechen und jeder Output nicht-leer sein.
    for (const r of results) {
      expect(r.text.trim().length).toBeGreaterThan(0);
    }
    // Plausibilität: einzelne Batch-Übersetzung stimmt mit Einzel-Übersetzung überein.
    const single = await translator.translate(inputs[1]!);
    expect(results[1]!.text).toBe(single.text);
    await translator.dispose();
  }, 600000);

  it("erhält Leerstrings im Batch", async () => {
    const engine = createOnnxEngine();
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const results = await translator.translateBatch(["", "Hallo", ""]);
    expect(results).toHaveLength(3);
    // Leerstring-Eingabe liefert leeren (oder whitespace-only) Output, kein Content-Loss.
    expect(results[0]!.text.trim()).toBe("");
    expect(results[2]!.text.trim()).toBe("");
    expect(results[1]!.text.trim().length).toBeGreaterThan(0);
    await translator.dispose();
  }, 600000);
});

// ---------------------------------------------------------------------------
// WebGPU / device selection tests (Step 10)
// ---------------------------------------------------------------------------

describe("TransformersEngine device selection", () => {
  it("capabilities() ist vor load { engine: 'onnx' } ohne device/dtype", () => {
    const engine = createOnnxEngine();
    const caps = engine.capabilities();
    expect(caps.engine).toBe("onnx");
    expect(caps.device).toBeUndefined();
    expect(caps.dtype).toBeUndefined();
  });

  it("device: 'wasm' übersetzt 'Hallo Welt' und meldet wasm/bnb4", async () => {
    const engine = createOnnxEngine({ device: "wasm" });
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    const result = await translator.translate("Hallo Welt");
    expect(result.engine).toBe("onnx");
    const caps = engine.capabilities();
    expect(caps.device).toBe("wasm");
    expect(caps.dtype).toBe("bnb4");
    await translator.dispose();
  }, 600000);

  it.runIf(!webgpuAvailable)(
    "device: 'webgpu' wirft ENGINE_NOT_SUPPORTED ohne GPU",
    async () => {
      const engine = createOnnxEngine({ device: "webgpu" });
      const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
      await expect(translator.preload()).rejects.toThrow(/WebGPU is not available/);
    },
  );

  it.runIf(webgpuAvailable)(
    "device: 'webgpu' lädt mit GPU und meldet webgpu/bnb4",
    async () => {
      const engine = createOnnxEngine({ device: "webgpu" });
      const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
      await translator.preload();
      const caps = engine.capabilities();
      expect(caps.device).toBe("webgpu");
      expect(caps.dtype).toBe("bnb4");
      const result = await translator.translate("Hallo Welt");
      expect(result.text.length).toBeGreaterThan(0);
      await translator.dispose();
    },
    600000,
  );

  it("device: 'auto' wählt wasm in Umgebungen ohne GPU", async () => {
    if (await detectWebGpu()) {
      // Wenn WebGPU verfügbar ist, überspringen wir diesen Test (er testet
      // den Fallback-Pfad, der nur ohne GPU relevant ist).
      return;
    }
    const engine = createOnnxEngine({ device: "auto" });
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.preload();
    const caps: TranslationCapabilities = engine.capabilities();
    expect(caps.engine).toBe("onnx");
    expect(caps.device).toBe("wasm");
    expect(caps.dtype).toBe("bnb4");
    expect(caps.modelId).toContain("opus-mt");
    await translator.dispose();
  }, 600000);
});

// ---------------------------------------------------------------------------
// removeModel / cache management (Step 16)
// ---------------------------------------------------------------------------

describe("TransformersEngine removeModel", () => {
  it("löscht gecachte Modell-Dateien aus dem Cache Storage", async () => {
    const engine = createOnnxEngine({ device: "wasm" });
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.preload();
    expect(await translator.isCached()).toBe(true);
    await translator.removeModel();
    expect(await translator.isCached()).toBe(false);
    // Re-preload should re-download (engine.load called again)
    await translator.preload();
    expect(await translator.isCached()).toBe(true);
    await translator.dispose();
  }, 600000);
});

// ---------------------------------------------------------------------------
// Debug events (Step 16)
// ---------------------------------------------------------------------------

describe("TransformersEngine debug events", () => {
  it("emits worker-spawn and device-resolved during preload", async () => {
    const engine = createOnnxEngine({ device: "wasm" });
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
    expect(types).toContain("worker-spawn");
    expect(types).toContain("device-resolved");
    const deviceResolved = events.find((e) => e.type === "device-resolved");
    if (deviceResolved?.type === "device-resolved") {
      expect(deviceResolved.engine).toBe("onnx");
      expect(deviceResolved.device).toBe("wasm");
      expect(deviceResolved.dtype).toBe("bnb4");
    }
    await translator.dispose();
  }, 600000);

  it("emits translate-start/done on translate()", async () => {
    const engine = createOnnxEngine({ device: "wasm" });
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
    await translator.dispose();
  }, 600000);

  it("emits inference-start/done bracketing the model call", async () => {
    const engine = createOnnxEngine({ device: "wasm" });
    const events: DebugEvent[] = [];
    const translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [engine],
      onDebug: (e) => events.push(e),
    });
    await translator.translate("Hallo Welt");
    const start = events.find((e) => e.type === "inference-start");
    const done = events.find((e) => e.type === "inference-done");
    // Both events must be present for the single translate() roundtrip.
    expect(start).toBeDefined();
    expect(done).toBeDefined();
    if (start?.type === "inference-start" && done?.type === "inference-done") {
      // Both events refer to the same worker request.
      expect(start.requestId).toBe(done.requestId);
      expect(start.engine).toBe("onnx");
      expect(done.engine).toBe("onnx");
      // Single translate() sends exactly one text to the model.
      expect(start.batchSize).toBe(1);
      expect(done.batchSize).toBe(1);
      expect(start.inputChars).toBe("Hallo Welt".length);
      expect(done.inputChars).toBe("Hallo Welt".length);
      expect(done.outputChars).toBeGreaterThan(0);
      expect(done.durationMs).toBeGreaterThan(0);
      // inference-start must precede inference-done, and both must sit
      // between translate-start and translate-done.
      const order = events.map((e) => e.type);
      expect(order.indexOf("translate-start")).toBeLessThan(order.indexOf("inference-start"));
      expect(order.indexOf("inference-start")).toBeLessThan(order.indexOf("inference-done"));
      expect(order.indexOf("inference-done")).toBeLessThan(order.indexOf("translate-done"));
      // Pure inference time must not exceed the total translate duration.
      const translateDone = events.find((e) => e.type === "translate-done");
      if (translateDone?.type === "translate-done") {
        expect(done.durationMs).toBeLessThanOrEqual(translateDone.durationMs);
      }
    }
    await translator.dispose();
  }, 600000);

  it("emits one inference-start/done pair per batch chunk", async () => {
    const engine = createOnnxEngine({ device: "wasm" });
    const events: DebugEvent[] = [];
    const translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [engine],
      onDebug: (e) => events.push(e),
    });
    const inputs = ["Hallo Welt", "Guten Morgen", "Wie geht es dir?"];
    await translator.translateBatch(inputs);
    const starts = events.filter((e) => e.type === "inference-start");
    const dones = events.filter((e) => e.type === "inference-done");
    // The 3 short texts fit into a single chunk (MAX_BATCH/MAX_BATCH_CHARS
    // not exceeded) → exactly one worker roundtrip.
    expect(starts).toHaveLength(1);
    expect(dones).toHaveLength(1);
    const start = starts[0];
    const done = dones[0];
    if (start?.type === "inference-start" && done?.type === "inference-done") {
      expect(start.requestId).toBe(done.requestId);
      expect(start.batchSize).toBe(3);
      expect(done.batchSize).toBe(3);
      expect(start.inputChars).toBe(inputs.reduce((sum, t) => sum + t.length, 0));
      expect(done.inputChars).toBe(inputs.reduce((sum, t) => sum + t.length, 0));
      expect(done.outputChars).toBeGreaterThan(0);
    }
    await translator.dispose();
  }, 600000);
});
