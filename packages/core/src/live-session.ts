import { createEmitter, type Emitter } from "./emitter.js";
import { ERROR_CODES, TranslatorError } from "./errors.js";
import type { LiveSegment, LiveSessionOptions, LiveTranslationEvent } from "./types.js";
import type { Translator } from "./translator.js";

/**
 * Events emitted by a {@link LiveSession}.
 *
 * - `translation` — a new (possibly partial) translation is available.
 * - `error` — a translation failed; the argument is a {@link TranslatorError}.
 * - `dispose` — the session was disposed and can no longer be used.
 *
 * Declared as a type alias with an index signature so it satisfies the
 * emitter's `ListenerMap` constraint.
 */
export type LiveSessionEvents = {
  translation: [event: LiveTranslationEvent];
  error: [error: TranslatorError];
  dispose: [];
  [event: string]: unknown[];
};

/** Default debounce window in milliseconds. */
const DEFAULT_DEBOUNCE = 250;

/**
 * Matches a sentence boundary: one or more characters ending with a
 * terminator (`.`, `!`, `?`, `;`) followed by whitespace, or a newline.
 * Used by {@link splitSegments} to split live input into cacheable units.
 */
const SEGMENT_SPLIT = /([^.!?;\n]*[.!?;]+[ \t\r]*|[^\n]*\n)/g;

/**
 * The result of segmenting input text. `complete` segments end at a sentence
 * boundary; the last element is the `partial` (still-growing tail) which may
 * be empty when the input ends exactly at a boundary.
 */
interface Segmentation {
  complete: string[];
  partial: string;
}

/**
 * Splits input text into complete segments (ending at sentence boundaries)
 * and a single partial tail. Whitespace-only segments are collapsed.
 *
 * @example
 * splitSegments("Hallo. Wie geht") // → { complete: ["Hallo."], partial: "Wie geht" }
 * splitSegments("Hallo. ")          // → { complete: ["Hallo."], partial: "" }
 */
export function splitSegments(input: string): Segmentation {
  if (input.trim() === "") {
    return { complete: [], partial: "" };
  }
  const complete: string[] = [];
  let partial = "";
  let lastIndex = 0;
  for (const match of input.matchAll(SEGMENT_SPLIT)) {
    const chunk = match[0] ?? "";
    lastIndex = (match.index ?? 0) + chunk.length;
    const trimmed = chunk.trim();
    if (trimmed !== "") {
      complete.push(trimmed);
    }
  }
  partial = input.slice(lastIndex);
  // When splitting leaves no trailing partial (input ends at a boundary),
  // the loop already consumed everything and partial is "" — correct.
  return { complete, partial: partial.trim() === "" ? "" : partial };
}

/**
 * A live translation session that translates incrementally as the user types
 * (chat) or as speech-to-text streams words in.
 *
 * The session segments the input at sentence boundaries. Segments that end
 * at a boundary ("complete") are translated **once** and cached; only the
 * still-growing tail ("partial") is re-translated on every update. This keeps
 * already-completed sentences stable while the active fragment adapts live.
 *
 * Outdated results (superseded by a newer `update()` before inference
 * finished) are discarded by a monotonic sequence number — no stale data
 * reaches the UI. Identical consecutive inputs skip inference entirely.
 *
 * The session is event-based: call {@link update} and listen for the
 * `translation` event.
 *
 * @example
 * ```ts
 * const live = translator.createLiveSession({ debounce: 250 });
 * live.on("translation", (e) => {
 *   console.log(e.text);     // full translation
 *   console.log(e.partial);  // still-growing tail
 * });
 * live.update("Hallo wie geht");
 * ```
 */
export class LiveSession {
  readonly #translator: Translator;
  readonly #debounce: number;
  readonly #emitter: Emitter<LiveSessionEvents>;
  /** Cache of source → translation for complete segments. */
  readonly #cache = new Map<string, string>();
  /** Monotonic sequence number; outdated async results are discarded. */
  #seq = 0;
  /** Last input, to skip identical consecutive updates. */
  #lastInput = "";
  /** Whether at least one update has been scheduled (so the first call always proceeds). */
  #seen = false;
  /** Pending debounce timer. */
  #timer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

  constructor(translator: Translator, options: LiveSessionOptions = {}) {
    this.#translator = translator;
    this.#debounce = options.debounce ?? DEFAULT_DEBOUNCE;
    this.#emitter = createEmitter<LiveSessionEvents>();
  }

  /** Subscribes to a session event. Returns an unsubscribe function. */
  on<K extends keyof LiveSessionEvents>(
    event: K,
    listener: (...args: LiveSessionEvents[K]) => void,
  ): () => void {
    this.#assertNotDisposed();
    return this.#emitter.on(event, listener);
  }

  /** Subscribes to a session event for a single invocation. */
  once<K extends keyof LiveSessionEvents>(
    event: K,
    listener: (...args: LiveSessionEvents[K]) => void,
  ): () => void {
    this.#assertNotDisposed();
    return this.#emitter.once(event, listener);
  }

  /** Removes a previously subscribed listener (one occurrence). */
  off<K extends keyof LiveSessionEvents>(
    event: K,
    listener: (...args: LiveSessionEvents[K]) => void,
  ): void {
    this.#emitter.off(event, listener);
  }

  /**
   * Updates the input text and schedules a debounced translation. Identical
   * consecutive inputs are skipped. Returns immediately; results arrive via
   * the `translation` event.
   *
   * An empty string clears the session and emits a `translation` event with
   * empty `text`/`partial`.
   */
  update(text: string): void {
    this.#assertNotDisposed();
    // Skip identical consecutive inputs — but always allow the very first
    // update so an empty initial input still produces a cleared event.
    if (this.#seen && text === this.#lastInput) {
      return;
    }
    this.#seen = true;
    this.#lastInput = text;
    const seq = ++this.#seq;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#run(seq, text);
    }, this.#debounce);
  }

  /**
   * Clears the segment cache and pending state. Useful when a new chat
   * message or speech turn begins and previous context should not influence
   * further translations. Emits a `translation` event with empty content.
   */
  clear(): void {
    this.#assertNotDisposed();
    this.#cache.clear();
    this.#lastInput = "";
    this.#seen = false;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#emitTranslation("", "", "", []);
  }

  /** Disposes the session: cancels pending work and releases the emitter. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#cache.clear();
    this.#emitter.emit("dispose");
    this.#emitter.clear();
  }

  /** Whether the session has been disposed. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Runs a single (debounced) translation cycle. */
  async #run(seq: number, text: string): Promise<void> {
    // Discard if a newer update superseded this one before the timer fired.
    if (seq !== this.#seq || this.#disposed) {
      return;
    }
    // Empty input: emit a cleared translation without inference.
    if (text.trim() === "") {
      this.#cache.clear();
      this.#emitTranslation("", text, "", []);
      return;
    }
    const { complete, partial } = splitSegments(text);
    // Determine which complete segments still need translation.
    const newComplete = complete.filter((s) => !this.#cache.has(s));
    // The partial is always re-translated (it grows on every keystroke).
    const toTranslate = [...newComplete];
    if (partial !== "") {
      toTranslate.push(partial);
    }
    try {
      let results: string[] = [];
      if (toTranslate.length > 0) {
        const batch = await this.#translator.translateBatch(toTranslate);
        // Discard if a newer update arrived while we were awaiting.
        if (seq !== this.#seq || this.#disposed) {
          return;
        }
        results = batch.map((r) => r.text);
      }
      // Write new complete segments into the cache (partial is NOT cached).
      let offset = 0;
      for (const source of newComplete) {
        this.#cache.set(source, results[offset] ?? source);
        offset += 1;
      }
      const partialTranslation =
        partial !== "" ? results[offset] ?? partial : "";
      // Assemble the full event from cached + partial.
      this.#emitAssembled(text, complete, partial, partialTranslation);
    } catch (error) {
      if (seq !== this.#seq || this.#disposed) {
        return;
      }
      const err =
        error instanceof TranslatorError
          ? error
          : new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "Live translation failed", {
              cause: error,
            });
      this.#emitter.emit("error", err);
    }
  }

  /** Builds and emits a `translation` event from cached + partial results. */
  #emitAssembled(
    source: string,
    complete: string[],
    partial: string,
    partialTranslation: string,
  ): void {
    const segments: LiveSegment[] = [];
    const parts: string[] = [];
    for (const seg of complete) {
      const translation = this.#cache.get(seg) ?? seg;
      segments.push({ source: seg, translation, complete: true });
      if (translation !== "") {
        parts.push(translation);
      }
    }
    if (partial !== "") {
      segments.push({ source: partial, translation: partialTranslation, complete: false });
      if (partialTranslation !== "") {
        parts.push(partialTranslation);
      }
    }
    const text = parts.join(" ");
    this.#emitTranslation(text, source, partialTranslation, segments);
  }

  /** Emits a fully-formed translation event. */
  #emitTranslation(
    text: string,
    source: string,
    partial: string,
    segments: LiveSegment[],
  ): void {
    this.#emitter.emit("translation", { text, source, partial, segments });
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new TranslatorError(ERROR_CODES.TRANSLATION_FAILED, "LiveSession has been disposed");
    }
  }
}