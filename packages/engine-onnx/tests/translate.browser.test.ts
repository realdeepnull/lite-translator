import { describe, expect, it } from "vitest";
import { createTranslator, type ProgressEvent } from "@lite-translator/core";
import { createOnnxEngine, detectWebGpu, type ResolvedCapabilities } from "../src/index.js";

/**
 * Browser integration test: loads a (quantized) OPUS-MT model from the
 * HF Hub and performs a real translation. It fails under network/CI restrictions
 * Test fehl — er ist bewusst kein Unit-Test.
 */

/** True when `navigator.gpu` is available (WebGPU capable environment). */
const webgpuAvailable = typeof navigator !== "undefined" && "gpu" in navigator;
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
  it("capabilities() ist vor load 'auto'", () => {
    const engine = createOnnxEngine();
    const caps = engine.capabilities();
    expect(caps.device).toBe("auto");
    expect(caps.dtype).toBe("auto");
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
    "device: 'webgpu' lädt mit GPU und meldet webgpu/fp16 oder fp32",
    async () => {
      const engine = createOnnxEngine({ device: "webgpu" });
      const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
      await translator.preload();
      const caps = engine.capabilities();
      expect(caps.device).toBe("webgpu");
      expect(["fp16", "fp32"]).toContain(caps.dtype);
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
    const caps: ResolvedCapabilities = engine.capabilities() as ResolvedCapabilities;
    expect(caps.device).toBe("wasm");
    expect(caps.dtype).toBe("bnb4");
    await translator.dispose();
  }, 600000);
});
