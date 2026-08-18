import { createStaticRegistry, type ModelDescriptor } from "@lite-translator/core";

/** Engine-ID dieses Engines. Wird in TranslationResult.engine verwendet. */
export const ENGINE_ID = "onnx";

const HF_BASE = "https://huggingface.co";

/**
 * Default language models (quantized OPUS-MT models on the HF Hub).
 * Can be overridden with createOnnxEngine({ models }) or replaced with
 * smaller models for testing.
 */
export const defaultModelIds: Record<string, string> = {
  "de-en": import.meta.env?.VITE_MODEL_ID_DE_EN ?? "Xenova/opus-mt-de-en",
  "en-de": import.meta.env?.VITE_MODEL_ID_EN_DE ?? "Xenova/opus-mt-en-de",
};

/** Creates the static model registry for the given pair-to-model-ID entries. */
export function createDefaultRegistry(modelIds: Record<string, string>) {
  const models: Record<string, ModelDescriptor> = {};
  for (const [pairKey, modelId] of Object.entries(modelIds)) {
    models[pairKey] = {
      id: modelId.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      version: "1.0.0",
      engine: ENGINE_ID,
      engineModelId: modelId,
      files: [
        { url: `${HF_BASE}/${modelId}/resolve/main/tokenizer_config.json` },
        { url: `${HF_BASE}/${modelId}/resolve/main/config.json` },
        { url: `${HF_BASE}/${modelId}/resolve/main/tokenizer.json` },
        { url: `${HF_BASE}/${modelId}/resolve/main/generation_config.json` },
        { url: `${HF_BASE}/${modelId}/resolve/main/onnx/encoder_model_quantized.onnx` },
        { url: `${HF_BASE}/${modelId}/resolve/main/onnx/decoder_model_merged_quantized.onnx` },
      ],
      metadata: { source: "huggingface" },
    };
  }
  return createStaticRegistry(models);
}
