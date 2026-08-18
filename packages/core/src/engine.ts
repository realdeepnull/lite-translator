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

  /** Releases memory and runtime resources. */
  dispose(): Promise<void>;
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
