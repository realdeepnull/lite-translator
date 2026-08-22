/** Library error codes, stable for consumers. */
export const ERROR_CODES = {
  MODEL_NOT_AVAILABLE: "MODEL_NOT_AVAILABLE",
  MODEL_DOWNLOAD_FAILED: "MODEL_DOWNLOAD_FAILED",
  MODEL_LOAD_FAILED: "MODEL_LOAD_FAILED",
  LANGUAGE_PAIR_NOT_SUPPORTED: "LANGUAGE_PAIR_NOT_SUPPORTED",
  ENGINE_NOT_SUPPORTED: "ENGINE_NOT_SUPPORTED",
  OUT_OF_MEMORY: "OUT_OF_MEMORY",
  TRANSLATION_FAILED: "TRANSLATION_FAILED",
  OFFLINE_MODEL_MISSING: "OFFLINE_MODEL_MISSING",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Base class for all library errors. */
export class TranslatorError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TranslatorError";
    this.code = code;
  }
}

/** Type guard for TranslatorError. */
export function isTranslatorError(error: unknown): error is TranslatorError {
  return error instanceof TranslatorError;
}

/**
 * Formats any error into a consistent, human-readable string.
 *
 * `TranslatorError` instances produce `"Fehler: <code>: <message>"`;
 * all other values produce `"Fehler: <message>"` (falling back to
 * `String(err)` when no `.message` is available). Replaces the duplicated
 * `formatError()` helpers and inline `isTranslatorError` checks found across
 * framework integrations.
 */
export function formatTranslatorError(err: unknown): string {
  if (isTranslatorError(err)) {
    return `Fehler: ${err.code}: ${err.message}`;
  }
  return `Fehler: ${(err as { message?: string })?.message ?? String(err)}`;
}
