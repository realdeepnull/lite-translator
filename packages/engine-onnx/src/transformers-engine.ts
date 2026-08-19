import {
  ERROR_CODES,
  TranslatorError,
  isStaticRegistry,
  languagePairKey,
  type LanguagePair,
  type ModelRegistry,
  type ProgressCallback,
  type StaticModelRegistry,
  type TranslationEngine,
  type TranslationResult,
} from "@lite-translator/core";
import { ENGINE_ID } from "./models.js";

/**
 * Maximum number of texts sent to the worker in a single batch request.
 * Bounds memory pressure: the ONNX KV-cache grows with batch × sequence length.
 * Batches larger than this are chunked into sequential worker roundtrips.
 */
const MAX_BATCH = 32;

interface ProgressEventPayload {
  phase: string;
  loaded: number;
  total: number;
  progress: number;
}

type WorkerResponse =
  | { kind: "progress"; id: number; event: ProgressEventPayload }
  | { kind: "loaded"; id: number }
  | { kind: "result"; id: number; text: string }
  | { kind: "result"; id: number; texts: string[] }
  | { kind: "disposed"; id: number }
  | { kind: "error"; id: number; message: string };

interface PendingRequest {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: unknown) => void;
  onEvent?: (response: WorkerResponse) => void;
}

/**
 * Engine implementation based on Transformers.js,
 * running in a Web Worker.
 */
export class TransformersEngine implements TranslationEngine {
  readonly id = ENGINE_ID;

  readonly #registry: StaticModelRegistry;
  #worker: Worker | undefined;
  #disposed = false;
  #loadedPair: string | undefined;
  #loadPromise: Promise<void> | undefined;
  #requestId = 0;
  readonly #pending = new Map<number, PendingRequest>();

  constructor(registry: ModelRegistry | StaticModelRegistry) {
    if (!isStaticRegistry(registry)) {
      throw new TranslatorError(
        ERROR_CODES.ENGINE_NOT_SUPPORTED,
        "TransformersEngine requires a synchronous (static) ModelRegistry. " +
          "Use a registry implementing StaticModelRegistry (e.g. createStaticRegistry/preloadRegistry).",
      );
    }
    this.#registry = registry;
  }

  /** Ob das Modell ohne Netzwerk verfügbar ist (Cache Storage). */
  async isCached(pair: LanguagePair): Promise<boolean> {
    const descriptor = await this.#requireModel(pair);
    if (typeof caches === "undefined") {
      return false;
    }
    for (const file of descriptor.files) {
      const match = await caches.match(file.url);
      if (!match) {
        return false;
      }
    }
    return true;
  }

  /** Loads the model in the worker (lazy, idempotent per pair). */
  load(pair: LanguagePair, onProgress?: ProgressCallback): Promise<void> {
    this.#assertNotDisposed();
    const key = languagePairKey(pair);
    if (this.#loadPromise && this.#loadedPair === key) {
      return this.#loadPromise;
    }
    this.#loadPromise = this.#loadModel(pair, onProgress);
    this.#loadedPair = key;
    return this.#loadPromise;
  }

  /** Translates after loading. */
  async translate(
    text: string,
    pair: LanguagePair,
  ): Promise<TranslationResult> {
    this.#assertNotDisposed();
    if (this.#loadedPair !== languagePairKey(pair)) {
      await this.load(pair);
    }
    const response = await this.#request({ kind: "translate", id: this.#nextId(), text });
    if (response.kind !== "result" || !("text" in response)) {
      throw new TranslatorError(
        ERROR_CODES.TRANSLATION_FAILED,
        response.kind === "error" ? response.message : "Unexpected worker response",
      );
    }
    return {
      text: response.text,
      from: pair.from,
      to: pair.to,
      engine: this.id,
    };
  }

  /**
   * Translates multiple texts in a single worker roundtrip via native ONNX
   * batching. Input order is preserved; empty strings are passed through
   * unchanged (not sent to the model). Batches larger than MAX_BATCH are
   * chunked to bound memory pressure (KV-cache grows with batch × seq-len).
   */
  async translateBatch(
    texts: string[],
    pair: LanguagePair,
  ): Promise<TranslationResult[]> {
    this.#assertNotDisposed();
    if (this.#loadedPair !== languagePairKey(pair)) {
      await this.load(pair);
    }
    // Track which inputs are non-empty; empty strings pass through unchanged.
    const nonEmptyIndices: number[] = [];
    const nonEmptyTexts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]!;
      if (text.length > 0) {
        nonEmptyIndices.push(i);
        nonEmptyTexts.push(text);
      }
    }

    const translated: string[] = new Array(texts.length).fill("");
    for (let i = 0; i < nonEmptyTexts.length; i += MAX_BATCH) {
      const chunk = nonEmptyTexts.slice(i, i + MAX_BATCH);
      const response = await this.#request({ kind: "translate", id: this.#nextId(), texts: chunk });
      if (response.kind !== "result" || !("texts" in response)) {
        throw new TranslatorError(
          ERROR_CODES.TRANSLATION_FAILED,
          response.kind === "error" ? response.message : "Unexpected worker response",
        );
      }
      for (let j = 0; j < chunk.length; j++) {
        translated[nonEmptyIndices[i + j]!] = response.texts[j] ?? "";
      }
    }

    return translated.map((text) => ({ text, from: pair.from, to: pair.to, engine: this.id }));
  }

  /** Whether the engine knows this pair according to the registry (synchronously). */
  supports(pair: LanguagePair): boolean {
    const model = this.#registry.getModelSync(pair);
    return model !== undefined && model.engine === ENGINE_ID;
  }

  /** Terminates the worker and resets the cache marker. */
  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    try {
      if (this.#worker) {
        try {
          await this.#request({ kind: "dispose", id: this.#nextId() });
        } catch {
          // Ignore worker errors during disposal.
        }
        this.#worker.terminate();
      }
    } finally {
      this.#worker = undefined;
      this.#loadedPair = undefined;
      this.#loadPromise = undefined;
      for (const pending of this.#pending.values()) {
        pending.reject(new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Engine disposed"));
      }
      this.#pending.clear();
    }
  }

  async #requireModel(pair: LanguagePair) {
    const descriptor = await this.#registry.getModel(pair);
    if (!descriptor) {
      throw new TranslatorError(
        ERROR_CODES.LANGUAGE_PAIR_NOT_SUPPORTED,
        `No model registered for ${languagePairKey(pair)}`,
      );
    }
    if (descriptor.engine !== ENGINE_ID) {
      throw new TranslatorError(
        ERROR_CODES.ENGINE_NOT_SUPPORTED,
        `Model ${descriptor.id} expects engine ${descriptor.engine}`,
      );
    }
    return descriptor;
  }
  async #loadModel(pair: LanguagePair, onProgress?: ProgressCallback): Promise<void> {
    const descriptor = await this.#requireModel(pair);
    const modelId = descriptor.engineModelId;
    if (!modelId) {
      throw new TranslatorError(
        ERROR_CODES.MODEL_NOT_AVAILABLE,
        `Model ${descriptor.id} has no engineModelId`,
      );
    }
    let downloaded = false;
    try {
      await this.#request(
        { kind: "load", id: this.#nextId(), modelId },
        (event) => {
          downloaded = true;
          if (event.kind === "progress") {
            onProgress?.(event.event);
          }
        },
      );
      this.#loadedPair = languagePairKey(pair);
    } catch (error) {
      this.#loadPromise = undefined;
      if (isOfflineError(error) && !(await this.isCached(pair))) {
        throw new TranslatorError(
          ERROR_CODES.OFFLINE_MODEL_MISSING,
          `Model for ${languagePairKey(pair)} is not cached and the browser is offline`,
          { cause: error },
        );
      }
      throw new TranslatorError(
        downloaded ? ERROR_CODES.MODEL_LOAD_FAILED : ERROR_CODES.MODEL_DOWNLOAD_FAILED,
        error instanceof Error ? error.message : "Failed to load model",
        { cause: error },
      );
    }
  }

  #nextId(): number {
    return ++this.#requestId;
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Engine has been disposed");
    }
  }

  #ensureWorker(): Worker {
    if (!this.#worker) {
      this.#worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.#handleMessage(event.data);
      };
      this.#worker.onerror = (event: ErrorEvent) => {
        for (const pending of this.#pending.values()) {
          pending.reject(
            new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, event.message || "Worker error"),
          );
        }
        this.#pending.clear();
      };
    }
    return this.#worker;
  }

  #handleMessage(response: WorkerResponse): void {
    const pending = this.#pending.get(response.id);
    if (!pending) {
      return;
    }
    if (response.kind === "progress") {
      pending.onEvent?.(response);
      return;
    }
    this.#pending.delete(response.id);
    if (response.kind === "error") {
      pending.reject(new Error(response.message ?? "Worker error"));
    } else {
      pending.resolve(response);
    }
  }

  #request(
    message: {
      kind: "load" | "translate" | "dispose";
      id: number;
      modelId?: string;
      text?: string;
      texts?: string[];
    },
    onEvent?: (response: WorkerResponse) => void,
  ): Promise<WorkerResponse> {
    const worker = this.#ensureWorker();
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.#pending.set(message.id, { resolve, reject, ...(onEvent ? { onEvent } : {}) });
      worker.postMessage(message);
    });
  }
}

function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|networkerror|network request failed|load failed/i.test(message);
}