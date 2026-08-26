import {
  ERROR_CODES,
  TranslatorError,
  isStaticRegistry,
  languagePairKey,
  type DebugCallback,
  type DebugEvent,
  type LanguagePair,
  type ModelRegistry,
  type ModelDescriptor,
  type ProgressCallback,
  type StaticModelRegistry,
  type TranslationCapabilities,
  type TranslationEngine,
  type TranslationResult,
  type TranslateOptions,
} from "@lite-translator/core";
import { ENGINE_ID } from "./models.js";
import {
  resolveDeviceDtype,
  type OnnxDevice,
  type OnnxDtype,
  type ResolvedDevice,
  type ResolvedDtype,
} from "./webgpu.js";

/**
 * Maximum number of texts sent to the worker in a single batch request.
 * Bounds memory pressure: the ONNX KV-cache grows with batch × sequence length.
 * Batches larger than this are chunked into sequential worker roundtrips.
 */
const MAX_BATCH = 32;

/** ONNX filename suffix for each resolved dtype (matches Transformers.js). */
const DTYPE_SUFFIX: Record<ResolvedDtype, string> = {
  fp16: "_fp16",
  fp32: "",
  bnb4: "_bnb4",
  q4f16: "_q4f16",
};

/** Returns a high-resolution timestamp in milliseconds. */
function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

interface ProgressEventPayload {
  phase: string;
  loaded: number;
  total: number;
  progress: number;
}

type WorkerResponse =
  | { kind: "progress"; id: number; event: ProgressEventPayload }
  | { kind: "capabilities"; id: number; device: string; dtype: string }
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
  readonly #device: OnnxDevice;
  readonly #dtype: OnnxDtype | undefined;
  #worker: Worker | undefined;
  #disposed = false;
  #loadedPair: string | undefined;
  #loadedModelId: string | undefined;
  #loadPromise: Promise<void> | undefined;
  #requestId = 0;
  readonly #pending = new Map<number, PendingRequest>();
  #resolvedDevice: ResolvedDevice | undefined;
  #resolvedDtype: ResolvedDtype | undefined;
  #onDebug: DebugCallback | undefined;

  constructor(
    registry: ModelRegistry | StaticModelRegistry,
    options: { device?: OnnxDevice; dtype?: OnnxDtype } = {},
  ) {
    if (!isStaticRegistry(registry)) {
      throw new TranslatorError(
        ERROR_CODES.ENGINE_NOT_SUPPORTED,
        "TransformersEngine requires a synchronous (static) ModelRegistry. " +
          "Use a registry implementing StaticModelRegistry (e.g. createStaticRegistry/preloadRegistry).",
      );
    }
    this.#registry = registry;
    this.#device = options.device ?? "auto";
    this.#dtype = options.dtype;
  }

  /**
   * Returns the resolved capabilities (device, dtype, model info), or a
   * minimal `{ engine }` before load.
   */
  capabilities(): TranslationCapabilities {
    const caps: TranslationCapabilities = { engine: this.id };
    if (this.#resolvedDevice) caps.device = this.#resolvedDevice;
    if (this.#resolvedDtype) caps.dtype = this.#resolvedDtype;
    if (this.#loadedModelId) caps.modelId = this.#loadedModelId;
    return caps;
  }

  /** Ob das Modell ohne Netzwerk verfügbar ist (Cache Storage). */
  async isCached(pair: LanguagePair): Promise<boolean> {
    const descriptor = await this.#requireModel(pair);
    if (typeof caches === "undefined") {
      return false;
    }
    // When device/dtype is resolved, check the dtype-specific ONNX URLs
    // (e.g. _fp16.onnx for WebGPU+fp16) instead of the registry's default
    // (_bnb4.onnx). Non-ONNX files (tokenizer, config) are dtype-independent.
    const urls = this.#cacheCheckUrls(descriptor);
    for (const url of urls) {
      const match = await caches.match(url);
      if (!match) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns the URLs to check in Cache Storage for `isCached()`.
   *
   * Non-ONNX files (tokenizer, config, generation_config) come from the
   * descriptor and are dtype-independent. ONNX model files are computed from
   * the resolved dtype when available, or fall back to the descriptor's file
   * list (which uses the default bnb4 suffix).
   */
  #cacheCheckUrls(descriptor: ModelDescriptor): string[] {
    const nonOnnx = descriptor.files
      .filter((f) => !f.url.endsWith(".onnx"))
      .map((f) => f.url);
    if (this.#resolvedDtype) {
      return [...nonOnnx, ...this.#expectedOnnxUrls(descriptor, this.#resolvedDtype)];
    }
    // Before load: use the descriptor's file list as-is (bnb4 default).
    return descriptor.files.map((f) => f.url);
  }

  /**
   * Computes the expected ONNX model file URLs for the given descriptor and
   * resolved dtype. Transformers.js selects ONNX files by appending a dtype
   * suffix to the base model name (e.g. `encoder_model_bnb4.onnx` for bnb4,
   * `encoder_model_fp16.onnx` for fp16, `encoder_model.onnx` for fp32).
   */
  #expectedOnnxUrls(descriptor: ModelDescriptor, dtype: ResolvedDtype): string[] {
    const modelId = descriptor.engineModelId;
    if (!modelId) return [];
    const suffix = DTYPE_SUFFIX[dtype];
    const base = `https://huggingface.co/${modelId}/resolve/main/onnx`;
    return [
      `${base}/encoder_model${suffix}.onnx`,
      `${base}/decoder_model_merged${suffix}.onnx`,
    ];
  }

  /**
   * Loads the model in the worker (lazy, idempotent per pair).
   *
   * When switching to a different pair while a model is already loaded, the
   * old model is disposed in the worker first — the worker supports only one
   * model at a time (`handleLoad` throws "Worker already loaded model"
   * otherwise). This keeps the shared engine usable across pairs without
   * requiring a separate worker per pair.
   */
  load(pair: LanguagePair, onProgress?: ProgressCallback, onDebug?: DebugCallback): Promise<void> {
    this.#assertNotDisposed();
    const key = languagePairKey(pair);
    if (this.#loadPromise && this.#loadedPair === key) {
      return this.#loadPromise;
    }
    if (onDebug) this.#onDebug = onDebug;
    this.#loadPromise = this.#loadModel(pair, onProgress);
    this.#loadedPair = key;
    return this.#loadPromise;
  }

  /**
   * Disposes the currently loaded model in the worker (without terminating
   * the worker) so that a different model can be loaded next. Used internally
   * by `#loadModel` before loading a new pair. If no model is loaded or the
   * dispose fails, it is a no-op — the worker is resilient to a second load
   * after a failed dispose because `handleDispose` resets `pipe` to undefined.
   */
  async #disposeLoadedModel(): Promise<void> {
    if (!this.#worker || this.#loadedPair === undefined) {
      return;
    }
    try {
      await this.#request({ kind: "dispose", id: this.#nextId() });
    } catch {
      // Ignore — the worker may have already disposed or errored.
    }
    this.#loadedPair = undefined;
    this.#loadedModelId = undefined;
  }

  /** Translates after loading. */
  async translate(
    text: string,
    pair: LanguagePair,
    options?: TranslateOptions,
  ): Promise<TranslationResult> {
    this.#assertNotDisposed();
    if (this.#loadedPair !== languagePairKey(pair)) {
      await this.load(pair);
    }
    const id = this.#nextId();
    const response = await this.#requestWithAbort(
      { kind: "translate", id, text },
      options?.signal,
    );
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
    options?: TranslateOptions,
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
      const id = this.#nextId();
      const response = await this.#requestWithAbort(
        { kind: "translate", id, texts: chunk },
        options?.signal,
      );
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
      this.#loadedModelId = undefined;
      this.#loadPromise = undefined;
      for (const pending of this.#pending.values()) {
        pending.reject(new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Engine disposed"));
      }
      this.#pending.clear();
    }
  }

  /**
   * Removes the cached model files for the given pair from browser Cache
   * Storage. If the model is currently loaded for this pair, it is disposed
   * in the worker first so that the files are not in use.
   *
   * Deletes the dtype-specific ONNX files (based on the resolved dtype) plus
   * the shared tokenizer/config files — the same URLs that `isCached()` checks.
   */
  async removeModel(pair: LanguagePair): Promise<void> {
    this.#assertNotDisposed();
    const descriptor = await this.#requireModel(pair);
    if (typeof caches === "undefined") {
      return; // Non-browser environment — nothing to do.
    }
    // If the currently loaded pair matches, dispose it first.
    if (this.#loadedPair === languagePairKey(pair)) {
      await this.#disposeLoadedModel();
      this.#loadPromise = undefined;
    }
    const urls = this.#cacheCheckUrls(descriptor);
    // Iterate all Cache Storage caches — Transformers.js may use any cache
    // name, and there are typically very few caches in an app.
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      for (const url of urls) {
        await cache.delete(url);
      }
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
    // Dispose the currently loaded model in the worker before loading a new
    // one — the worker supports only one model at a time. This allows the
    // shared engine to switch pairs without a separate worker per pair.
    await this.#disposeLoadedModel();
    // Resolve device/dtype asynchronously (WebGPU probing is async).
    const caps = await resolveDeviceDtype(this.#device, this.#dtype);
    this.#debug({
      type: "device-resolved",
      timestamp: now(),
      engine: this.id,
      device: caps.device,
      dtype: caps.dtype,
    });
    let downloaded = false;
    try {
      await this.#sendLoad(modelId, caps.device, caps.dtype, onProgress, (downloadedFlag) => {
        downloaded = downloadedFlag;
      });
      this.#loadedPair = languagePairKey(pair);
      this.#loadedModelId = modelId;
    } catch (error) {
      // WebGPU→WASM fallback: if device was "auto" and WebGPU was selected but
      // failed at runtime (adapter creation failed, fp16 not actually supported,
      // etc.), retry once with WASM + bnb4. Explicit "webgpu" requests do NOT
      // retry — the user asked for WebGPU specifically.
      if (this.#device === "auto" && caps.device === "webgpu") {
        this.#debug({
          type: "device-fallback",
          timestamp: now(),
          engine: this.id,
          from: "webgpu",
          to: "wasm",
        });
        const fallback = { device: "wasm" as const, dtype: "bnb4" as const };
        try {
          downloaded = false;
          await this.#sendLoad(modelId, fallback.device, fallback.dtype, onProgress, (f) => {
            downloaded = f;
          });
          this.#loadedPair = languagePairKey(pair);
          this.#loadedModelId = modelId;
          return;
        } catch (fallbackError) {
          this.#loadPromise = undefined;
          throw new TranslatorError(
            downloaded ? ERROR_CODES.MODEL_LOAD_FAILED : ERROR_CODES.MODEL_DOWNLOAD_FAILED,
            fallbackError instanceof Error ? fallbackError.message : "Failed to load model",
            { cause: fallbackError },
          );
        }
      }
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

  /**
   * Sends a load request to the worker with the resolved device/dtype and
   * captures the capabilities response. Calls `onDownloaded(true)` when
   * progress events indicate a download has started.
   */
  async #sendLoad(
    modelId: string,
    device: ResolvedDevice,
    dtype: ResolvedDtype,
    onProgress: ProgressCallback | undefined,
    onDownloaded: (downloaded: boolean) => void,
  ): Promise<void> {
    const response = await this.#request(
      { kind: "load", id: this.#nextId(), modelId, device, dtype },
      (event) => {
        if (event.kind === "progress") {
          onDownloaded(true);
          onProgress?.(event.event);
        } else if (event.kind === "capabilities") {
          this.#resolvedDevice = event.device as ResolvedDevice;
          this.#resolvedDtype = event.dtype as ResolvedDtype;
        }
      },
    );
    // The final response should be "loaded"; capabilities may have arrived
    // as an earlier progress event. If capabilities weren't captured, set
    // them from the known resolved values.
    if (!this.#resolvedDevice || !this.#resolvedDtype) {
      this.#resolvedDevice = device;
      this.#resolvedDtype = dtype;
    }
    void response; // response.kind === "loaded"
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
      this.#debug({ type: "worker-spawn", timestamp: now(), engine: this.id });
      this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.#handleMessage(event.data);
      };
      this.#worker.onerror = (event: ErrorEvent) => {
        this.#debug({
          type: "worker-error",
          timestamp: now(),
          engine: this.id,
          message: event.message || "Worker error",
        });
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

  /** Emits a debug event when the onDebug callback is present. */
  #debug(event: DebugEvent): void {
    this.#onDebug?.(event);
  }

  #handleMessage(response: WorkerResponse): void {
    const pending = this.#pending.get(response.id);
    if (!pending) {
      return;
    }
    if (response.kind === "progress" || response.kind === "capabilities") {
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
      device?: string;
      dtype?: string;
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

  /**
   * Like {@link #request}, but rejects the pending promise when the given
   * `AbortSignal` fires. The worker result (if it arrives after abort) is
   * silently dropped via the existing `if (!pending) return` guard in
   * `#handleMessage`. Transformers.js `pipe()` cannot cancel mid-inference, so
   * the worker continues — only the caller's promise is rejected.
   */
  #requestWithAbort(
    message: { kind: "translate"; id: number; text?: string; texts?: string[] },
    signal?: AbortSignal,
  ): Promise<WorkerResponse> {
    const promise = this.#request(message);
    if (!signal) return promise;
    if (signal.aborted) {
      this.#pending.delete(message.id);
      return Promise.reject(
        new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Translation aborted"),
      );
    }
    const onAbort = () => {
      const pending = this.#pending.get(message.id);
      if (pending) {
        this.#pending.delete(message.id);
        pending.reject(
          new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Translation aborted"),
        );
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    // Clean up the listener when the request settles normally.
    return promise.finally(() => signal.removeEventListener("abort", onAbort));
  }
}

function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|networkerror|network request failed|load failed/i.test(message);
}