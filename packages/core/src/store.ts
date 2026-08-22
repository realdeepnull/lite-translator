/**
 * A minimal, framework-neutral reactive store for i18n-style translation keys.
 *
 * Components register strings via `register(key, text)` and read the current
 * value via `get(key)`. After `translateAll()` resolves, the store is updated
 * with the translated strings and all subscribers are notified.
 *
 * Frameworks (Angular, React, Vue) bind to this store via `subscribe()` and
 * `snapshot()` — core has no framework dependency.
 */
export class TranslationStore {
  /** key → current value (original first, translation after update). */
  readonly #entries = new Map<string, string>();
  /** key → original text, kept for re-translation / inspection. */
  readonly #originals = new Map<string, string>();
  /** Reactive listeners, notified on register() and set(). */
  readonly #listeners = new Set<() => void>();
  /** Dirty flag: when true, snapshot() must rebuild the cached snapshot. */
  #dirty = true;
  /** Cached snapshot, frozen to prevent external mutation. Rebuilt on change. */
  #cachedSnapshot: Record<string, string> = Object.freeze({});

  /**
   * Marks the store dirty (next snapshot() rebuilds) and notifies subscribers.
   */
  #markDirty(): void {
    this.#dirty = true;
    this.#notify();
  }

  /**
   * Registers a key with its original text. If the key already exists, the
   * value is overwritten and listeners are notified. Returns the registered
   * text so callers can use the result synchronously.
   */
  register(key: string, text: string): string {
    this.#entries.set(key, text);
    this.#originals.set(key, text);
    this.#markDirty();
    return text;
  }

  /**
   * Returns the current value for a key, or `undefined` if the key was never
   * registered. Callers that want i18n-style fallback (key as text) should
   * use `get(key) ?? key`.
   */
  get(key: string): string | undefined {
    return this.#entries.get(key);
  }

  /**
   * Sets the translated value for a key and notifies subscribers. Internal
   * use by `Translator.translateAll()`.
   */
  set(key: string, translated: string): void {
    this.#entries.set(key, translated);
    this.#markDirty();
  }

  /** Original text for a key (never changes after register). */
  original(key: string): string | undefined {
    return this.#originals.get(key);
  }

  /** Whether a key has been registered. */
  has(key: string): boolean {
    return this.#entries.has(key);
  }

  /** All registered `[key, value]` pairs. Order is insertion order. */
  entries(): IterableIterator<[string, string]> {
    return this.#entries.entries();
  }

  /** All registered keys. */
  keys(): IterableIterator<string> {
    return this.#entries.keys();
  }

  /** Number of registered keys. */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Subscribes to store changes. The listener is called on `register()` and
   * `set()`. Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Returns a plain snapshot `{ key: value }` of the current store state.
   * Useful for frameworks that need a value comparison (e.g. React
   * `useSyncExternalStore`).
   *
   * The snapshot is cached and frozen: repeated calls without an intervening
   * `register()` / `set()` / `clear()` return the **same reference**, so
   * frameworks can compare with `===` instead of shallow-equal. The object is
   * frozen to prevent external mutation of the shared reference.
   */
  snapshot(): Record<string, string> {
    if (this.#dirty) {
      this.#cachedSnapshot = Object.freeze(Object.fromEntries(this.#entries));
      this.#dirty = false;
    }
    return this.#cachedSnapshot;
  }

  /** Removes all registered keys. */
  clear(): void {
    this.#entries.clear();
    this.#originals.clear();
    this.#markDirty();
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}