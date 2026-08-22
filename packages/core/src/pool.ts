import { createTranslator, type Translator } from "./translator.js";
import { languagePairKey } from "./registry.js";
import type { ProgressCallback } from "./types.js";
import type { TranslationEngine } from "./engine.js";

/** Options for {@link TranslatorPool}. */
export interface TranslatorPoolOptions {
  /**
   * Optional list of engines. If omitted, the globally registered default
   * engines (`getDefaultEngines()`) are used.
   */
  engines?: TranslationEngine[];
  /** Optional progress callback forwarded to every created translator. */
  onProgress?: ProgressCallback;
  /**
   * Maximum number of cached translators. When exceeded, the oldest entry
   * (LRU eviction via Map insertion order) is disposed. Default: unlimited.
   */
  maxSize?: number;
}

/**
 * A reusable pool of translators keyed by language pair.
 *
 * Replaces the ad-hoc `Map<string, Translator>` + `switchTo()` pattern that is
 * reimplemented in every framework integration. `switchTo(from, to)` returns a
 * cached translator immediately when available, otherwise creates one via
 * `createTranslator()`. An optional `maxSize` enables LRU eviction: the oldest
 * cached translator is disposed when the pool exceeds the limit.
 *
 * @example
 * ```ts
 * const pool = new TranslatorPool({
 *   engines: [createOnnxEngine()],
 *   maxSize: 3,
 * });
 * const t1 = await pool.switchTo("de", "en");
 * const t2 = await pool.switchTo("de", "en"); // same instance as t1
 * const pairs = pool.cachedPairs();           // ["de-en"]
 * await pool.dispose();                       // disposes all cached translators
 * ```
 */
export class TranslatorPool {
  /** Map preserves insertion order for LRU eviction. */
  readonly #cache = new Map<string, Translator>();
  readonly #engines: TranslationEngine[] | undefined;
  readonly #onProgress: ProgressCallback | undefined;
  readonly #maxSize: number | undefined;

  constructor(options: TranslatorPoolOptions = {}) {
    this.#engines = options.engines;
    this.#onProgress = options.onProgress;
    this.#maxSize = options.maxSize;
  }

  /**
   * Returns the translator for the given language pair, creating it on first
   * use. When the pair is already cached, the cached instance is returned
   * immediately (no model reload).
   */
  async switchTo(from: string, to: string): Promise<Translator> {
    const key = languagePairKey({ from, to });
    const cached = this.#cache.get(key);
    if (cached) {
      // Refresh insertion order for LRU semantics (re-insert moves to end).
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return cached;
    }

    const translator = await createTranslator({
      from,
      to,
      ...(this.#engines !== undefined && { engines: this.#engines }),
      ...(this.#onProgress !== undefined && { onProgress: this.#onProgress }),
    });
    this.#cache.set(key, translator);
    this.#enforceMaxSize();
    return translator;
  }

  /**
   * Returns the cached translator for the given pair, or `undefined` when not
   * cached. Does not create a translator.
   */
  get(from: string, to: string): Translator | undefined {
    return this.#cache.get(languagePairKey({ from, to }));
  }

  /** The currently cached translator, or `undefined` when the pool is empty. */
  current(): Translator | undefined {
    return this.#cache.values().next().value;
  }

  /** All cached language-pair keys (e.g. `["de-en", "en-de"]`). */
  cachedPairs(): string[] {
    return [...this.#cache.keys()];
  }

  /** Number of cached translators. */
  get size(): number {
    return this.#cache.size;
  }

  /** Disposes the translator for a single pair and removes it from the cache. */
  async disposePair(from: string, to: string): Promise<void> {
    const key = languagePairKey({ from, to });
    const translator = this.#cache.get(key);
    if (translator) {
      await translator.dispose();
      this.#cache.delete(key);
    }
  }

  /** Disposes all cached translators and clears the pool. */
  async dispose(): Promise<void> {
    await Promise.all([...this.#cache.values()].map((t) => t.dispose()));
    this.#cache.clear();
  }

  /**
   * Enforces the `maxSize` limit by disposing the oldest cached translator
   * (Map keys() iteration order = insertion order = LRU order).
   */
  #enforceMaxSize(): void {
    if (this.#maxSize === undefined) return;
    while (this.#cache.size > this.#maxSize) {
      const oldestKey = this.#cache.keys().next().value;
      if (oldestKey === undefined) break;
      const translator = this.#cache.get(oldestKey);
      this.#cache.delete(oldestKey);
      void translator?.dispose();
    }
  }
}