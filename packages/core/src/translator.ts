import { ERROR_CODES, TranslatorError } from "./errors.js";
import type { TranslationEngine } from "./engine.js";
import { getDefaultEngines } from "./engine.js";
import { LiveSession } from "./live-session.js";
import { TranslationStore } from "./store.js";
import type {
  DebugCallback,
  DebugEvent,
  LanguagePair,
  LiveSessionOptions,
  ProgressCallback,
  TranslateOptions,
  TranslationCapabilities,
  TranslationResult,
  TranslatorOptions,
} from "./types.js";

/** Returns a high-resolution timestamp in milliseconds. */
function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Ein Translator kapselt ein Sprachpaar und das gewählte Engine.
 * Erstellen via createTranslator().
 */
export class Translator {
  readonly #pair: LanguagePair;
  readonly #engine: TranslationEngine;
  readonly #onProgress: ProgressCallback | undefined;
  readonly #onDebug: DebugCallback | undefined;
  #ready = false;
  #disposed = false;
  #loadPromise: Promise<void> | undefined;
  /** Lazily created i18n-style store, instantiated on first t() call. */
  #store: TranslationStore | undefined;

  constructor(
    options: TranslatorOptions,
    engine: TranslationEngine,
  ) {
    this.#pair = { from: options.from, to: options.to };
    this.#engine = engine;
    this.#onProgress = options.onProgress;
    this.#onDebug = options.onDebug;
  }

  /** Sprachpaar dieses Translators. */
  get pair(): LanguagePair {
    return { ...this.#pair };
  }

  /** Preloads the model. Idempotent. */
  preload(): Promise<void> {
    this.#assertNotDisposed();
    if (!this.#loadPromise) {
      this.#debug({ type: "load-start", timestamp: now(), pair: this.#pair });
      const start = now();
      this.#loadPromise = this.#engine
        .load(this.#pair, this.#onProgress, this.#onDebug)
        .then(() => {
          this.#ready = true;
          this.#debug({
            type: "load-done",
            timestamp: now(),
            pair: this.#pair,
            durationMs: now() - start,
          });
        });
    }
    return this.#loadPromise;
  }

  /** Translates text. Loads the model when needed. */
  async translate(text: string, options?: TranslateOptions): Promise<TranslationResult> {
    this.#assertNotDisposed();
    this.#assertNotAborted(options);
    if (!this.#ready) {
      await this.preload();
    }
    this.#debug({
      type: "translate-start",
      timestamp: now(),
      pair: this.#pair,
      inputLength: text.length,
    });
    const start = now();
    try {
      const result = await this.#engine.translate(text, this.#pair, options);
      this.#debug({
        type: "translate-done",
        timestamp: now(),
        pair: this.#pair,
        durationMs: now() - start,
        inputLength: text.length,
        outputLength: result.text.length,
      });
      return result;
    } catch (error) {
      if (error instanceof TranslatorError) {
        throw error;
      }
      throw new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Translation failed", {
        cause: error,
      });
    }
  }

  /**
   * Translates multiple texts in a single call (batched when the engine
   * supports it). Loads the model when needed. The result order matches the
   * input order; empty strings are preserved.
   */
  async translateBatch(texts: string[], options?: TranslateOptions): Promise<TranslationResult[]> {
    this.#assertNotDisposed();
    this.#assertNotAborted(options);
    if (!this.#ready) {
      await this.preload();
    }
    this.#debug({
      type: "batch-start",
      timestamp: now(),
      pair: this.#pair,
      batchSize: texts.length,
    });
    const start = now();
    try {
      const results = await this.#engine.translateBatch(texts, this.#pair, options);
      this.#debug({
        type: "batch-done",
        timestamp: now(),
        pair: this.#pair,
        durationMs: now() - start,
        batchSize: texts.length,
      });
      return results;
    } catch (error) {
      if (error instanceof TranslatorError) {
        throw error;
      }
      throw new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Batch translation failed", {
        cause: error,
      });
    }
  }

  /**
   * Returns a bound `t(key, text?)` function for i18n-style batch translation.
   *
   * - `t("my.key", "Hallo")` registers the key and returns the original text
   *   synchronously.
   * - `t("my.key")` returns the current value (translation after
   *   `translateAll()`, original before, or the key itself if never
   *   registered — i18n fallback convention).
   *
   * The store is shared across all `t()` calls from the same translator.
   */
  t(): (key: string, text?: string) => string {
    if (!this.#store) {
      this.#store = new TranslationStore();
    }
    const store = this.#store;
    return (key: string, text?: string): string => {
      this.#assertNotDisposed();
      if (text !== undefined) {
        return store.register(key, text);
      }
      return store.get(key) ?? key;
    };
  }

  /**
   * The reactive store backing `t()`. Created lazily on first `t()` call.
   * Frameworks (Angular, React, Vue) subscribe to it for reactive template
   * updates. Returns `undefined` if `t()` was never called.
   */
  store(): TranslationStore | undefined {
    return this.#store;
  }

  /**
   * Translates all strings registered via `t()` in a single `translateBatch()`
   * call. After resolving, the store is updated with the translated values and
   * all subscribers are notified. Loads the model when needed.
   *
   * If no strings are registered, this is a no-op.
   *
   * Identical values are deduplicated before inference to avoid redundant
   * work.
   */
  async translateAll(options?: TranslateOptions): Promise<void> {
    this.#assertNotDisposed();
    this.#assertNotAborted(options);
    if (!this.#store || this.#store.size === 0) {
      return;
    }
    if (!this.#ready) {
      await this.preload();
    }
    const all = [...this.#store.entries()];
    // Deduplicate values: identical source strings share one inference.
    const unique = [...new Set(all.map(([, value]) => value))];
    this.#debug({
      type: "translateall-start",
      timestamp: now(),
      pair: this.#pair,
      keyCount: this.#store.size,
    });
    const start = now();
    try {
      const results = await this.#engine.translateBatch(unique, this.#pair, options);
      const valueToTranslation = new Map<string, string>();
      for (let i = 0; i < unique.length; i++) {
        valueToTranslation.set(unique[i]!, results[i]?.text ?? unique[i]!);
      }
      // Batch-update the store: a single notify for all keys instead of one
      // per key (subscribers re-evaluate once, not N times).
      const updates: [string, string][] = [];
      for (const [key, value] of all) {
        const translated = valueToTranslation.get(value);
        if (translated !== undefined) {
          updates.push([key, translated]);
        }
      }
      this.#store.setMany(updates);
      this.#debug({
        type: "translateall-done",
        timestamp: now(),
        pair: this.#pair,
        durationMs: now() - start,
        keyCount: this.#store.size,
        uniqueCount: unique.length,
      });
    } catch (error) {
      if (error instanceof TranslatorError) {
        throw error;
      }
      throw new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "translateAll failed", {
        cause: error,
      });
    }
  }

  /**
   * Creates a live translation session for incremental input — e.g. typing in
   * a chat or streaming words from speech-to-text.
   *
   * The session segments input at sentence boundaries, caches translations
   * of completed sentences, and only re-translates the still-growing tail on
   * each `update()`. Outdated results are discarded automatically.
   *
   * @example
   * ```ts
   * const live = translator.createLiveSession({ debounce: 250 });
   * live.on("translation", (e) => console.log(e.text));
   * live.update("Hallo wie geht");
   * ```
   */
  createLiveSession(options?: LiveSessionOptions): LiveSession {
    this.#assertNotDisposed();
    return new LiveSession(this, options);
  }

  /** true, wenn das Modell geladen und sofort einsatzbereit ist. */
  isReady(): boolean {
    return this.#ready;
  }

  /** true, wenn das Modell lokal gecacht ist (Offline-Nutzung möglich). */
  async isCached(): Promise<boolean> {
    this.#assertNotDisposed();
    return this.#engine.isCached(this.#pair);
  }

  /**
   * Returns the engine's resolved capabilities (device, dtype, model info),
   * or `undefined` if the engine does not implement `capabilities()` or the
   * model has not been loaded yet.
   */
  capabilities(): TranslationCapabilities | undefined {
    return this.#engine.capabilities?.();
  }

  /**
   * Removes the cached model files for this translator's language pair from
   * browser Cache Storage. If the model is currently loaded, it is disposed
   * first so that a subsequent `preload()` re-downloads the files.
   *
   * Throws `ENGINE_NOT_SUPPORTED` if the engine does not implement
   * `removeModel()`.
   */
  async removeModel(): Promise<void> {
    this.#assertNotDisposed();
    if (!this.#engine.removeModel) {
      throw new TranslatorError(
        ERROR_CODES.ENGINE_NOT_SUPPORTED,
        `Engine ${this.#engine.id} does not support removeModel`,
      );
    }
    // Reset the loaded state so a subsequent preload() re-downloads.
    this.#ready = false;
    this.#loadPromise = undefined;
    await this.#engine.removeModel(this.#pair);
  }

  /** Releases engine resources. The translator cannot be used afterward. */
  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#store?.clear();
    await this.#engine.dispose();
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Translator has been disposed");
    }
  }

  #assertNotAborted(options?: TranslateOptions): void {
    if (options?.signal?.aborted) {
      this.#debug({ type: "abort", timestamp: now(), pair: this.#pair });
      throw new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Translation aborted");
    }
  }

  /** Emits a debug event when the onDebug callback is present. */
  #debug(event: DebugEvent): void {
    this.#onDebug?.(event);
  }
}

/**
 * Creates a translator. Does not load a model yet.
 * Throws LANGUAGE_PAIR_NOT_SUPPORTED if no engine supports the pair.
 */
export async function createTranslator(options: TranslatorOptions): Promise<Translator> {
  const pair: LanguagePair = { from: options.from, to: options.to };
  const candidates = options.engines ?? getDefaultEngines();
  const engine = candidates.find((b) => b.supports(pair));
  if (!engine) {
    throw new TranslatorError(
      ERROR_CODES.LANGUAGE_PAIR_NOT_SUPPORTED,
      `No engine supports language pair ${pair.from}-${pair.to}`,
    );
  }
  return new Translator(options, engine);
}
