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

// Zirkuläre Typreferenz vermeiden: Interface wird in engine.ts definiert
// und hier nur referenziert.
import type { TranslationEngine } from "./engine.js";
