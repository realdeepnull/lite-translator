/**
 * Web Worker: loads a Transformers.js translation pipeline and runs
 * inference outside the main thread.
 *
 * Protocol (postMessage):
 *  → { kind: "load", id, modelId }
 *  → { kind: "translate", id, text }
 *  → { kind: "dispose", id }
 *  ← { kind: "progress", id, event }          (during load only)
 *  ← { kind: "loaded", id }                    (response to load)
 *  ← { kind: "result", id, text }              (response to translate)
 *  ← { kind: "disposed", id }                  (response to dispose)
 *  ← { kind: "error", id, message }            (on errors)
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
  (text: string | string[]): Promise<Array<{ translation_text: string }>>;
  dispose?(): Promise<void>;
}

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
  const output = (await pipe(input)) as Array<{ translation_text: string }>;
  const texts = output.map((o) => o?.translation_text ?? "");
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
