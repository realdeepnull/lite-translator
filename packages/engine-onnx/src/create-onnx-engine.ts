import { TransformersEngine } from "./transformers-engine.js";
import { createDefaultRegistry, defaultModelIds } from "./models.js";
import type { StaticModelRegistry } from "@lite-translator/core";
import type { OnnxDevice, OnnxDtype } from "./webgpu.js";

/** Options for createOnnxEngine(). */
export interface OnnxEngineOptions {
  /** Custom static registry, e.g. for tests or additional language pairs. */
  registry?: StaticModelRegistry;
  /** Overrides the default language-pair-to-model-ID mapping. */
  models?: Record<string, string>;
  /**
   * Device selection mode. Defaults to `"wasm"` — predictable latency in
   * every environment, no GPU probing. Use `"auto"` to probe `navigator.gpu`
   * and use WebGPU when an adapter is available (falling back to WASM), or
   * `"webgpu"` to require WebGPU (throws if unavailable).
   */
  device?: OnnxDevice;
  /**
   * Optional dtype override. When omitted the engine picks the safe default
   * for the resolved device: `"bnb4"` on both WebGPU and WASM (`fp16`
   * produces empty/garbage output for short strings; `q8`/`q4` trigger the
   * MatMulNBits regression; `fp32` triggers ShapeInferenceError on WASM).
   *
   * `"q4f16"` is accepted but may trigger a known onnxruntime-web
   * MatMulNBits regression.
   */
  dtype?: OnnxDtype;
}

/**
 * Creates a local ONNX engine (Transformers.js + Web Worker).
 * Default: de-en / en-de with quantized OPUS-MT models from the HF Hub.
 */
export function createOnnxEngine(options: OnnxEngineOptions = {}): TransformersEngine {
  const registry =
    options.registry ?? createDefaultRegistry(options.models ?? defaultModelIds);
  return new TransformersEngine(registry, {
    ...(options.device !== undefined && { device: options.device }),
    ...(options.dtype !== undefined && { dtype: options.dtype }),
  });
}