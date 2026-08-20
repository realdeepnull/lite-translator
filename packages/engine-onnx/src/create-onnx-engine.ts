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
   * Device selection mode. Defaults to `"auto"`, which uses WebGPU when
   * `navigator.gpu` and a GPU adapter are available, falling back to WASM.
   * Use `"webgpu"` to require WebGPU (throws if unavailable) or `"wasm"` to
   * force WASM.
   */
  device?: OnnxDevice;
  /**
   * Optional dtype override. When omitted the engine picks a safe default
   * for the resolved device: `"fp16"` on WebGPU (or `"fp32"` when
   * `shader-f16` is unavailable), `"bnb4"` on WASM.
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