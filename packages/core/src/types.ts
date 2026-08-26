/**
 * BCP-47-ähnlicher Sprachcode ohne Region, z.B. "de", "en".
 * Der String-Typ bleibt bewusst erweiterbar für weitere Sprachen.
 */
export type LanguageCode = string;

/** Ein gerichtetes Sprachpaar, z.B. de → en. */
export interface LanguagePair {
  from: LanguageCode;
  to: LanguageCode;
}

/** Ergebnis einer Übersetzung. */
export interface TranslationResult {
  text: string;
  from: LanguageCode;
  to: LanguageCode;
  /** ID des verwendeten Engines, z.B. "onnx". */
  engine: string;
}

/** Download- und Ladefortschritt von Modellen/Runtime. */
export interface ProgressEvent {
  /** Z.B. "model-download" oder "model-load". */
  phase: string;
  loaded: number;
  total: number;
  /** Gleitkommawert 0..1, oder NaN falls total unbekannt. */
  progress: number;
}

export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Engine-agnostic description of what an engine can do.
 *
 * `device` and `dtype` are optional plain strings so that any engine can
 * report its capabilities without depending on the ONNX-specific union
 * types. Engines that don't have a notion of device/dtype simply omit them.
 */
export interface TranslationCapabilities {
  /** Stable engine ID, e.g. "onnx". */
  engine: string;
  /** Resolved compute device, e.g. "webgpu" or "wasm". */
  device?: string;
  /** Resolved data type, e.g. "fp16" or "bnb4". */
  dtype?: string;
  /** Model identifier used by the engine, e.g. "onnx-community/opus-mt-de-en". */
  modelId?: string;
  /** Model version, if known. */
  modelVersion?: string;
}

/**
 * Structured debug event emitted via the optional `onDebug` callback.
 *
 * Events are grouped into three categories:
 * - **Load lifecycle** — `load-start` / `load-done` (model preload)
 * - **Translation timing** — `translate-*`, `batch-*`, `translateall-*`
 * - **Engine internals** — `worker-spawn`, `worker-error`, `device-resolved`,
 *   `device-fallback`, `abort`
 *
 * Every event carries a `timestamp` (from `performance.now()`).
 * The `onDebug` callback is opt-in and has zero overhead when absent.
 */
export type DebugEvent =
  | { type: "load-start"; timestamp: number; pair: LanguagePair }
  | { type: "load-done"; timestamp: number; pair: LanguagePair; durationMs: number }
  | {
      type: "translate-start";
      timestamp: number;
      pair: LanguagePair;
      inputLength: number;
    }
  | {
      type: "translate-done";
      timestamp: number;
      pair: LanguagePair;
      durationMs: number;
      inputLength: number;
      outputLength: number;
    }
  | {
      type: "batch-start";
      timestamp: number;
      pair: LanguagePair;
      batchSize: number;
    }
  | {
      type: "batch-done";
      timestamp: number;
      pair: LanguagePair;
      durationMs: number;
      batchSize: number;
    }
  | {
      type: "translateall-start";
      timestamp: number;
      pair: LanguagePair;
      keyCount: number;
    }
  | {
      type: "translateall-done";
      timestamp: number;
      pair: LanguagePair;
      durationMs: number;
      keyCount: number;
      uniqueCount: number;
    }
  | { type: "abort"; timestamp: number; pair: LanguagePair }
  | { type: "worker-spawn"; timestamp: number; engine: string }
  | { type: "worker-error"; timestamp: number; engine: string; message: string }
  | {
      type: "device-resolved";
      timestamp: number;
      engine: string;
      device: string;
      dtype: string;
    }
  | {
      type: "device-fallback";
      timestamp: number;
      engine: string;
      from: string;
      to: string;
    };

/** Optional debug callback for structured lifecycle/timing events. */
export type DebugCallback = (event: DebugEvent) => void;

/** Options for createTranslator(). */
export interface TranslatorOptions {
  from: LanguageCode;
  to: LanguageCode;
  /** Optional progress callback for model download/load. */
  onProgress?: ProgressCallback;
  /**
   * Optional debug callback for structured lifecycle and timing events.
   * Opt-in — zero overhead when absent.
   */
  onDebug?: DebugCallback;
  /**
  * Optional list of engines. If omitted, all globally registered engines
  * (registerDefaultEngine) are used.
   */
  engines?: TranslationEngine[];
}

/** Options for a single translate() / translateBatch() / translateAll() call. */
export interface TranslateOptions {
  /** AbortSignal to cancel the translation. When already aborted, the call rejects with TRANSLATION_FAILED. */
  signal?: AbortSignal;
}

/**
 * A single segment produced by the live session's segmentation step.
 *
 * Segments are derived by splitting the input at sentence boundaries
 * (`.`, `!`, `?`, `;`, newlines). All segments except the last are
 * considered "complete" — they have been translated once and cached. The
 * last segment is the "partial" — the still-growing tail of the input that
 * is re-translated on every update until it becomes complete.
 */
export interface LiveSegment {
  /** Original (source-language) segment text. */
  source: string;
  /** Translated text (empty until the segment has been translated). */
  translation: string;
  /** Whether the segment ends at a sentence boundary (cached, stable). */
  complete: boolean;
}

/**
 * Payload of the `translation` event emitted by a `LiveSession`.
 *
 * Designed for two primary use cases:
 * - **Chat:** show `text` (the full translation, complete segments joined
 *   with the partial).
 * - **Speech-to-Text:** show `text` for the stable part and `partial`
 *   separately for the still-growing tail, so the UI can render completed
 *   sentences firmly and the active fragment with a "typing" style.
 *
 * `segments` is exposed for advanced UIs that want to distinguish completed
 * sentences from the active fragment visually.
 */
export interface LiveTranslationEvent {
  /** Full translated text: all complete segment translations joined with the partial. */
  text: string;
  /** The original input string, verbatim. */
  source: string;
  /** Translation of the last, still-growing segment (empty when the input is fully complete). */
  partial: string;
  /** All segments in order, with their translations and completeness flag. */
  segments: LiveSegment[];
}

/** Options for `Translator.createLiveSession()`. */
export interface LiveSessionOptions {
  /** Debounce in milliseconds. Defaults to 250. */
  debounce?: number;
}

// Zirkuläre Typreferenz vermeiden: Interface wird in engine.ts definiert
// und hier nur referenziert.
import type { TranslationEngine } from "./engine.js";
