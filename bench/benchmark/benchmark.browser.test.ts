import { describe, it, expect } from "vitest";
import { createTranslator } from "@lite-translator/core";
import { createOnnxEngine, createDefaultRegistry, defaultModelIds, detectWebGpu } from "../../packages/engine-onnx/src/index.js";
import { qualityCases } from "../quality/cases.js";
import type { BenchMetrics } from "./types.js";

/**
 * de → en benchmark suite (report only, no gate).
 *
 * Measures:
 *  - cold start (create + preload incl. download)
 *  - first translation
 *  - warm translation (N=20, median / mean / p95)
 *  - model size (sum of cached response body sizes from Cache Storage)
 *
 * Memory is intentionally not measured: `performance.memory` is non-standard and
 * unreliable across browsers. Bundle sizes are measured separately by the
 * Node script `bundle-size.ts`.
 *
 * The metrics object is printed as a single line:
 *   BENCH_RESULT <json>
 * The Node wrapper (`run.ts`) parses this line and writes the report files.
 */

const PAIR = { from: "de", to: "en" } as const;
const WARM_ITERATIONS = 20;
const WARM_SAMPLE = "Hallo Welt, wie geht es dir?";

describe("de → en benchmark", () => {
  it("misst cold start, first/warm translation und Modellgröße", async () => {
    const registry = createDefaultRegistry(defaultModelIds);
    const modelFileUrls = registry.getModelSync(PAIR)?.files.map((f) => f.url) ?? [];

    // ---- cold start ------------------------------------------------------
    const engine = createOnnxEngine({ device: "wasm" });
    const t0 = performance.now();
    const translator = await createTranslator({
      ...PAIR,
      engines: [engine],
    });
    await translator.preload();
    const coldStartMs = performance.now() - t0;
    const caps = engine.capabilities();

    // ---- first translation ----------------------------------------------
    const tFirst = performance.now();
    const first = await translator.translate(WARM_SAMPLE);
    const firstTranslateMs = performance.now() - tFirst;
    expect(first.text.length).toBeGreaterThan(0);

    // ---- warm translations ----------------------------------------------
    const warmRunsMs: number[] = [];
    for (let i = 0; i < WARM_ITERATIONS; i++) {
      const t = performance.now();
      await translator.translate(WARM_SAMPLE);
      warmRunsMs.push(performance.now() - t);
    }

    // ---- batch translation (all quality-case inputs in one call) --------
    const batchInputs = qualityCases.map((c) => c.input);
    const tBatch = performance.now();
    const batchResults = await translator.translateBatch(batchInputs);
    const batchTranslateMs = performance.now() - tBatch;
    expect(batchResults).toHaveLength(batchInputs.length);
    expect(batchResults.every((r) => r.text.length >= 0)).toBe(true);

    // ---- model size via Cache Storage ------------------------------------
    const modelSize = await sumCachedSizes(modelFileUrls);

    await translator.dispose();

    const sorted = [...warmRunsMs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    const p95 = sorted[p95Index] ?? 0;
    const mean = warmRunsMs.reduce((a, b) => a + b, 0) / warmRunsMs.length;

    const metrics: BenchMetrics = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      pair: "de-en",
      device: caps.device,
      dtype: caps.dtype,
      coldStartMs: round(coldStartMs),
      firstTranslateMs: round(firstTranslateMs),
      warmRunsMs: warmRunsMs.map(round),
      warmMedianMs: round(median),
      warmP95Ms: round(p95),
      warmMeanMs: round(mean),
      warmIterations: WARM_ITERATIONS,
      batchTranslateMs: round(batchTranslateMs),
      batchInputsCount: batchInputs.length,
      modelSizeBytes: modelSize.bytes,
      modelFileCount: modelSize.count,
    };

    // Single-line marker for the Node wrapper to parse.
    console.log("BENCH_RESULT " + JSON.stringify(metrics));

    // Sanity assertions (report suite, not a strict gate).
    expect(metrics.coldStartMs).toBeGreaterThan(0);
    expect(metrics.warmMedianMs).toBeGreaterThan(0);
    expect(metrics.modelFileCount).toBeGreaterThan(0);
  }, 600_000);

  it.runIf(typeof navigator !== "undefined" && "gpu" in navigator)(
    "WebGPU: misst cold start, first/warm translation",
    async () => {
      // Only run when WebGPU is available. In headless CI this test is skipped.
      const hasGpu = await detectWebGpu();
      if (!hasGpu) return;

      const engine = createOnnxEngine({ device: "webgpu" });
      const t0 = performance.now();
      const translator = await createTranslator({
        ...PAIR,
        engines: [engine],
      });
      await translator.preload();
      const coldStartMs = performance.now() - t0;
      const caps = engine.capabilities();

      const tFirst = performance.now();
      const first = await translator.translate(WARM_SAMPLE);
      const firstTranslateMs = performance.now() - tFirst;
      expect(first.text.length).toBeGreaterThan(0);

      const warmRunsMs: number[] = [];
      for (let i = 0; i < WARM_ITERATIONS; i++) {
        const t = performance.now();
        await translator.translate(WARM_SAMPLE);
        warmRunsMs.push(performance.now() - t);
      }

      await translator.dispose();

      const sorted = [...warmRunsMs].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
      const p95 = sorted[p95Index] ?? 0;
      const mean = warmRunsMs.reduce((a, b) => a + b, 0) / warmRunsMs.length;

      const metrics: BenchMetrics = {
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        pair: "de-en",
        device: caps.device,
        dtype: caps.dtype,
        coldStartMs: round(coldStartMs),
        firstTranslateMs: round(firstTranslateMs),
        warmRunsMs: warmRunsMs.map(round),
        warmMedianMs: round(median),
        warmP95Ms: round(p95),
        warmMeanMs: round(mean),
        warmIterations: WARM_ITERATIONS,
        batchTranslateMs: 0,
        batchInputsCount: 0,
        modelSizeBytes: 0,
        modelFileCount: 0,
      };

      console.log("BENCH_RESULT_WEBGPU " + JSON.stringify(metrics));
      expect(metrics.coldStartMs).toBeGreaterThan(0);
      expect(metrics.warmMedianMs).toBeGreaterThan(0);
    },
    600_000,
  );
});

async function sumCachedSizes(urls: string[]): Promise<{ bytes: number; count: number }> {
  if (typeof caches === "undefined" || urls.length === 0) {
    return { bytes: 0, count: 0 };
  }
  let bytes = 0;
  let count = 0;
  for (const url of urls) {
    const match = await caches.match(url);
    if (!match) continue;
    const buf = await match.clone().arrayBuffer();
    bytes += buf.byteLength;
    count += 1;
  }
  return { bytes, count };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}