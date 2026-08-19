import type {
  LanguagePair,
  ProgressCallback,
  TranslateOptions,
  TranslationResult,
} from "./types.js";

/**
 * Engine-independent interface for a translation engine.
 * The core does not know any concrete implementation (Transformers.js, ONNX, ...).
 */
export interface TranslationEngine {
  /** Stable engine ID, e.g. "onnx". */
  readonly id: string;

  /** Checks whether the engine supports the language pair. */
  supports(pair: LanguagePair): boolean;

  /** Checks whether the model is cached locally (offline use is possible). */
  isCached(pair: LanguagePair): Promise<boolean>;

  /**
  * Loads the model and runtime. May be called multiple times;
  * repeated calls must be idempotent (no repeated download).
   */
  load(pair: LanguagePair, onProgress?: ProgressCallback): Promise<void>;

  /** Translates text. Lazily loads the model if it is not loaded yet. */
  translate(
    text: string,
    pair: LanguagePair,
    options?: TranslateOptions,
  ): Promise<TranslationResult>;

  /**
   * Translates multiple texts in a single call.
   *
   * Engines SHOULD use native batching when the runtime supports it
   * (e.g. Transformers.js `pipe([...])`), otherwise they MAY fall back to a
   * sequential `translate()` loop. The result order MUST match the input order
   * (result index i corresponds to input index i).
   *
   * Empty strings are preserved as empty results (no content loss).
   *
   * Lazily loads the model if it is not loaded yet.
   */
  translateBatch(
    texts: string[],
    pair: LanguagePair,
    options?: TranslateOptions,
  ): Promise<TranslationResult[]>;

  /** Releases memory and runtime resources. */
  dispose(): Promise<void>;
}

/**
 * Wraps an engine so that `translateBatch` is always available.
 *
 * If the engine already implements `translateBatch`, it is returned unchanged.
 * Otherwise a proxy is returned whose `translateBatch` sequentially calls
 * `translate()` for each input text, preserving input order. This keeps
 * third-party engines (that only implement `translate`) compatible with the
 * `TranslationEngine` contract introduced in 0.1.0 without requiring them to
 * implement native batching.
 */
export function withBatchFallback(engine: TranslationEngine): TranslationEngine {
  if (typeof engine.translateBatch === "function") {
    return engine;
  }
  return {
    ...engine,
    translateBatch: (texts, pair, options) =>
      texts.reduce<Promise<TranslationResult[]>>(
        async (acc, text) => [...(await acc), await engine.translate(text, pair, options)],
        Promise.resolve([]),
      ),
  };
}

const defaultEngines: TranslationEngine[] = [];

/**
 * Registers an engine globally as a default.
 * Enables convenience packages to register an engine on import.
 */
export function registerDefaultEngine(engine: TranslationEngine): void {
  if (!defaultEngines.some((b) => b.id === engine.id)) {
    defaultEngines.push(engine);
  }
}

/** Returns a copy of the globally registered default engines. */
export function getDefaultEngines(): readonly TranslationEngine[] {
  return defaultEngines;
}
