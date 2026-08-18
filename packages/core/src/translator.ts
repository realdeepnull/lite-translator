import { ERROR_CODES, TranslatorError } from "./errors.js";
import type { TranslationEngine } from "./engine.js";
import { getDefaultEngines } from "./engine.js";
import type {
  LanguagePair,
  ProgressCallback,
  TranslateOptions,
  TranslationResult,
  TranslatorOptions,
} from "./types.js";

/**
 * Ein Translator kapselt ein Sprachpaar und das gewählte Engine.
 * Erstellen via createTranslator().
 */
export class Translator {
  readonly #pair: LanguagePair;
  readonly #engine: TranslationEngine;
  readonly #onProgress: ProgressCallback | undefined;
  #ready = false;
  #disposed = false;
  #loadPromise: Promise<void> | undefined;

  constructor(
    options: TranslatorOptions,
    engine: TranslationEngine,
  ) {
    this.#pair = { from: options.from, to: options.to };
    this.#engine = engine;
    this.#onProgress = options.onProgress;
  }

  /** Sprachpaar dieses Translators. */
  get pair(): LanguagePair {
    return { ...this.#pair };
  }

  /** Preloads the model. Idempotent. */
  preload(): Promise<void> {
    this.#assertNotDisposed();
    if (!this.#loadPromise) {
      this.#loadPromise = this.#engine.load(this.#pair, this.#onProgress).then(() => {
        this.#ready = true;
      });
    }
    return this.#loadPromise;
  }

  /** Translates text. Loads the model when needed. */
  async translate(text: string, options?: TranslateOptions): Promise<TranslationResult> {
    this.#assertNotDisposed();
    if (!this.#ready) {
      await this.preload();
    }
    try {
      return await this.#engine.translate(text, this.#pair, options);
    } catch (error) {
      if (error instanceof TranslatorError) {
        throw error;
      }
      throw new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Translation failed", {
        cause: error,
      });
    }
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

  /** Releases engine resources. The translator cannot be used afterward. */
  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    await this.#engine.dispose();
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Translator has been disposed");
    }
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
