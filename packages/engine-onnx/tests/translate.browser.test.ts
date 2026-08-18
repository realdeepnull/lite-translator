import { describe, expect, it } from "vitest";
import { createTranslator, type ProgressEvent } from "@lite-translator/core";
import { createOnnxEngine } from "../src/index.js";

/**
 * Browser integration test: loads a (quantized) OPUS-MT model from the
 * HF Hub and performs a real translation. It fails under network/CI restrictions
 * Test fehl — er ist bewusst kein Unit-Test.
 */
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
});
