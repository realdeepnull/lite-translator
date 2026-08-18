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
let pipe: PipelineInstance | undefined;
let loadPromise: Promise<void> | undefined;

interface LoadMessage {
  kind: "load";
  id: number;
  modelId: string;
}
interface TranslateMessage {
  kind: "translate";
  id: number;
  text: string;
}
interface DisposeMessage {
  kind: "dispose";
  id: number;
}
type Request = LoadMessage | TranslateMessage | DisposeMessage;

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
        await handleLoad(msg.id, msg.modelId);
        break;
      case "translate":
        await handleTranslate(msg.id, msg.text);
        break;
      case "dispose":
        await handleDispose(msg.id);
        break;
    }
  } catch (error) {
    postError(msg.id, error);
  }
};

async function handleLoad(id: number, modelId: string): Promise<void> {
  if (pipe) {
    if (activeModelId === modelId) {
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
      const created = (await pipeline("translation", modelId, {
        dtype: "q8",
        progress_callback: progressCallback,
      })) as unknown as PipelineInstance;
      pipe = created;
      activeModelId = modelId;
    })();
  }
  await loadPromise;
  post({ kind: "loaded", id });
}

async function handleTranslate(id: number, text: string): Promise<void> {
  if (!pipe) {
    throw new Error("Model not loaded");
  }
  const output = (await pipe(text)) as Array<{ translation_text: string }>;
  const first = output[0];
  post({ kind: "result", id, text: first?.translation_text ?? "" });
}

async function handleDispose(id: number): Promise<void> {
  if (pipe?.dispose) {
    await pipe.dispose();
  }
  pipe = undefined;
  activeModelId = undefined;
  loadPromise = undefined;
  post({ kind: "disposed", id });
}

type Response =
  | { kind: "progress"; id: number; event: ProgressEvent }
  | { kind: "loaded"; id: number }
  | { kind: "result"; id: number; text: string }
  | { kind: "disposed"; id: number }
  | { kind: "error"; id: number; message: string };

function post(message: Response): void {
  (self as unknown as { postMessage(msg: Response): void }).postMessage(message);
}

function postError(id: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  post({ kind: "error", id, message });
}
