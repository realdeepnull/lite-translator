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

/** Options for createTranslator(). */
export interface TranslatorOptions {
  from: LanguageCode;
  to: LanguageCode;
  /** Optional progress callback for model download/load. */
  onProgress?: ProgressCallback;
  /**
  * Optional list of engines. If omitted, all globally registered engines
  * (registerDefaultEngine) are used.
   */
  engines?: TranslationEngine[];
}

/** Options for a single translate() call. */
export type TranslateOptions = Record<string, never>;

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
