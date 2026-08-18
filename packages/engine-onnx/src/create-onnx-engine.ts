import { TransformersEngine } from "./transformers-engine.js";
import { createDefaultRegistry, defaultModelIds } from "./models.js";
import type { StaticModelRegistry } from "@lite-translator/core";

/** Options for createOnnxEngine(). */
export interface OnnxEngineOptions {
  /** Custom static registry, e.g. for tests or additional language pairs. */
  registry?: StaticModelRegistry;
  /** Overrides the default language-pair-to-model-ID mapping. */
  models?: Record<string, string>;
}

/**
 * Creates a local ONNX engine (Transformers.js + Web Worker).
 * Default: de-en / en-de with quantized OPUS-MT models from the HF Hub.
 */
export function createOnnxEngine(options: OnnxEngineOptions = {}): TransformersEngine {
  const registry =
    options.registry ?? createDefaultRegistry(options.models ?? defaultModelIds);
  return new TransformersEngine(registry);
}