/**
 * Web Worker: loads a Transformers.js translation pipeline and runs
 * inference outside the main thread.
 *
 * Protocol (postMessage):
 *  → { kind: "load", id, modelId }
 *  → { kind: "translate", id, text }
 *  → { kind: "dispose", id }
 *  ← { kind: "progress", id, event }          (during load only)
 *  ← { kind: "capabilities", id, device, dtype } (response to load)
 *  ← { kind: "loaded", id }                    (response to load)
 *  ← { kind: "inference-start", id, batchSize, inputChars }  (before model call)
 *  ← { kind: "inference-done", id, batchSize, inputChars, outputChars, durationMs }
 *  ← { kind: "result", id, text }              (response to translate)
 *  ← { kind: "disposed", id }                  (response to dispose)
 *  ← { kind: "error", id, message }            (on errors)
 *
 * The inference-* events are debug timing instrumentation: they bracket the
 * actual model invocation so consumers can tell worker roundtrip overhead
 * apart from pure model inference time.
 *
 * The worker instance is tied to one model ID: load() throws for another modelId.
 */
import { pipeline, env } from "@huggingface/transformers";

// Local model paths must not be used in the browser/worker: the worker is
// served relative to the consumer origin, and an SPA fallback (e.g. Angular/Vite
// dev server) returns index.html with status 200 for every URL. Transformers.js
// would parse this HTML as an ONNX protobuf and fail. Therefore, load only
// remote models from the HF Hub.
env.allowLocalModels = false;
env.allowRemoteModels = true;

interface PipelineInstance {
  (text: string | string[], options?: { max_new_tokens?: number }): Promise<
    Array<{ translation_text: string }>
  >;
  dispose?(): Promise<void>;
}

/**
 * Default token limit for the decoder. Without `max_new_tokens`, the
 * OPUS-MT/MarianMT decoder keeps running on short inputs (single words,
 * UI labels) and hallucinates — repetitions, punctuation streams, empty
 * output — which also inflates tail latency. 512 covers full sentences
 * while bounding runaway generation.
 */
const DEFAULT_MAX_NEW_TOKENS = 512;

let activeModelId: string | undefined;
let activeDevice: string | undefined;
let activeDtype: string | undefined;
let pipe: PipelineInstance | undefined;
let loadPromise: Promise<void> | undefined;

interface LoadMessage {
  kind: "load";
  id: number;
  modelId: string;
  /** Resolved device ("webgpu" | "wasm"). Omitted for backward compat. */
  device?: string;
  /** Resolved dtype (e.g. "fp16", "bnb4"). Omitted for backward compat. */
  dtype?: string;
}
interface TranslateMessage {
  kind: "translate";
  id: number;
  text: string;
}
interface TranslateBatchMessage {
  kind: "translate";
  id: number;
  texts: string[];
}
interface DisposeMessage {
  kind: "dispose";
  id: number;
}
type Request = LoadMessage | TranslateMessage | TranslateBatchMessage | DisposeMessage;

interface ProgressEvent {
  phase: string;
  loaded: number;
  total: number;
  progress: number;
}

interface TransformersProgress {
  status?: string;
  name?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const msg = event.data;
  try {
    switch (msg.kind) {
      case "load":
        await handleLoad(msg.id, msg.modelId, msg.device, msg.dtype);
        break;
      case "translate":
        await handleTranslate(msg.id, "texts" in msg ? msg.texts : msg.text);
        break;
      case "dispose":
        await handleDispose(msg.id);
        break;
    }
  } catch (error) {
    postError(msg.id, error);
  }
};

async function handleLoad(
  id: number,
  modelId: string,
  device?: string,
  dtype?: string,
): Promise<void> {
  if (pipe) {
    if (activeModelId === modelId) {
      post({ kind: "capabilities", id, device: activeDevice ?? "wasm", dtype: activeDtype ?? "bnb4" });
      post({ kind: "loaded", id });
      return;
    }
    throw new Error(`Worker already loaded model "${activeModelId}"`);
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      const progressCallback = (p: TransformersProgress) => {
        if (p.status === "progress" || p.status === "download") {
          const loaded = p.loaded ?? 0;
          const total = p.total ?? 0;
          const event: ProgressEvent = {
            phase: "model-download",
            loaded,
            total,
            progress: total > 0 ? loaded / total : Number.NaN,
          };
          post({ kind: "progress", id, event });
        }
      };
      // Resolve device/dtype: use provided values, or default to WASM + bnb4
      // (the safe default — v4 defaults to WebGPU which is unavailable in many
      //  environments; bnb4 avoids the MatMulNBits regression that affects
      //  q8/int8/uint8/q4 on v4's onnxruntime-web).
      const resolvedDevice = device ?? "wasm";
      const resolvedDtype = dtype ?? "bnb4";
      const created = (await pipeline("translation", modelId, {
        device: resolvedDevice as "webgpu" | "wasm",
        dtype: resolvedDtype as "fp16" | "fp32" | "bnb4" | "q4f16",
        progress_callback: progressCallback,
      })) as unknown as PipelineInstance;
      pipe = created;
      activeModelId = modelId;
      activeDevice = resolvedDevice;
      activeDtype = resolvedDtype;
    })();
  }
  await loadPromise;
  post({ kind: "capabilities", id, device: activeDevice ?? "wasm", dtype: activeDtype ?? "bnb4" });
  post({ kind: "loaded", id });
}

async function handleTranslate(id: number, payload: string | string[]): Promise<void> {
  if (!pipe) {
    throw new Error("Model not loaded");
  }
  const isBatch = Array.isArray(payload);
  // Transformers.js pipe accepts string | string[]; normalize single text to a
  // one-element array so the output shape is always Array<{ translation_text }>.
  const input = isBatch ? payload : [payload];
  const batchSize = input.length;
  const inputChars = input.reduce((sum, text) => sum + text.length, 0);
  // Debug timing instrumentation: emit inference-start right before the input
  // is handed to the model, inference-done right after the output arrives.
  post({ kind: "inference-start", id, batchSize, inputChars });
  const start = performance.now();
  // Cap decoder generation to prevent runaway generation on short inputs
  // (hallucinated repetitions/punctuation) and bound tail latency.
  const output = (await pipe(input, {
    max_new_tokens: DEFAULT_MAX_NEW_TOKENS,
  })) as Array<{ translation_text: string }>;
  const durationMs = performance.now() - start;
  const texts = output.map((o) => o?.translation_text ?? "");
  const outputChars = texts.reduce((sum, text) => sum + text.length, 0);
  post({ kind: "inference-done", id, batchSize, inputChars, outputChars, durationMs });
  if (isBatch) {
    post({ kind: "result", id, texts });
  } else {
    post({ kind: "result", id, text: texts[0] ?? "" });
  }
}

async function handleDispose(id: number): Promise<void> {
  if (pipe?.dispose) {
    await pipe.dispose();
  }
  pipe = undefined;
  activeModelId = undefined;
  activeDevice = undefined;
  activeDtype = undefined;
  loadPromise = undefined;
  post({ kind: "disposed", id });
}

type Response =
  | { kind: "progress"; id: number; event: ProgressEvent }
  | { kind: "capabilities"; id: number; device: string; dtype: string }
  | { kind: "loaded"; id: number }
  | { kind: "inference-start"; id: number; batchSize: number; inputChars: number }
  | {
      kind: "inference-done";
      id: number;
      batchSize: number;
      inputChars: number;
      outputChars: number;
      durationMs: number;
    }
  | { kind: "result"; id: number; text: string }
  | { kind: "result"; id: number; texts: string[] }
  | { kind: "disposed"; id: number }
  | { kind: "error"; id: number; message: string };

function post(message: Response): void {
  (self as unknown as { postMessage(msg: Response): void }).postMessage(message);
}

function postError(id: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  post({ kind: "error", id, message });
}
