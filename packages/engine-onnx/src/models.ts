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
  "de-en": import.meta.env?.VITE_MODEL_ID_DE_EN ?? "onnx-community/opus-mt-de-en",
  "en-de": import.meta.env?.VITE_MODEL_ID_EN_DE ?? "onnx-community/opus-mt-en-de",
  "fr-en": import.meta.env?.VITE_MODEL_ID_FR_EN ?? "onnx-community/opus-mt-fr-en",
  "en-fr": import.meta.env?.VITE_MODEL_ID_EN_FR ?? "onnx-community/opus-mt-en-fr",
  "es-en": import.meta.env?.VITE_MODEL_ID_ES_EN ?? "onnx-community/opus-mt-es-en",
  "en-es": import.meta.env?.VITE_MODEL_ID_EN_ES ?? "onnx-community/opus-mt-en-es",
  "it-en": import.meta.env?.VITE_MODEL_ID_IT_EN ?? "onnx-community/opus-mt-it-en",
  "en-it": import.meta.env?.VITE_MODEL_ID_EN_IT ?? "onnx-community/opus-mt-en-it",
  "nl-en": import.meta.env?.VITE_MODEL_ID_NL_EN ?? "onnx-community/opus-mt-nl-en",
  "en-nl": import.meta.env?.VITE_MODEL_ID_EN_NL ?? "onnx-community/opus-mt-en-nl",
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
        { url: `${HF_BASE}/${modelId}/resolve/main/onnx/encoder_model_bnb4.onnx` },
        { url: `${HF_BASE}/${modelId}/resolve/main/onnx/decoder_model_merged_bnb4.onnx` },
      ],
      metadata: { source: "huggingface" },
    };
  }
  return createStaticRegistry(models);
}
