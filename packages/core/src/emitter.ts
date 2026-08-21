/**
 * A minimal, framework-neutral, typed event emitter.
 *
 * Core has no runtime dependency on any framework or the browser-only
 * `EventTarget`. This emitter is a few lines of pure TypeScript that work in
 * Node (unit tests) and in the browser alike. It is generic over a map of
 * event names to argument tuples so call-sites stay fully typed.
 *
 * Listeners are called in subscription order. `emit()` is synchronous.
 */
/** Legacy alias kept for backwards compatibility. */
export type ListenerMap = Record<string, unknown[]>;

export interface Emitter<Events extends ListenerMap> {
  /**
   * Subscribes to an event. Returns an unsubscribe function.
   * The same listener can be subscribed more than once and will be called
   * once per subscription.
   */
  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): () => void;

  /**
   * Subscribes to an event and unsubscribes after the first invocation.
   */
  once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): () => void;

  /** Removes a previously subscribed listener (one occurrence). */
  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): void;

  /** Emits an event, calling all matching listeners in subscription order. */
  emit<K extends keyof Events>(event: K, ...args: Events[K]): void;

  /** Removes all listeners for an event (or all events when called without). */
  clear<K extends keyof Events>(event?: K): void;
}

/**
 * Creates a new typed event emitter.
 *
 * @example
 * ```ts
 * const e = createEmitter<{ change: [value: string] }>();
 * const off = e.on("change", (v) => console.log(v));
 * e.emit("change", "hi"); // → "hi"
 * off();
 * ```
 */
export function createEmitter<Events extends ListenerMap>(): Emitter<Events> {
  const listeners = new Map<keyof Events, Array<(...args: unknown[]) => void>>();

  const on = <K extends keyof Events>(event: K, listener: (...args: Events[K]) => void) => {
    const set = listeners.get(event) ?? [];
    set.push(listener as (...args: unknown[]) => void);
    listeners.set(event, set);
    return () => off(event, listener);
  };

  const once = <K extends keyof Events>(event: K, listener: (...args: Events[K]) => void) => {
    const wrapper: (...args: Events[K]) => void = (...args) => {
      off(event, wrapper);
      listener(...args);
    };
    return on(event, wrapper);
  };

  const off = <K extends keyof Events>(event: K, listener: (...args: Events[K]) => void) => {
    const set = listeners.get(event);
    if (!set) return;
    const idx = set.indexOf(listener as (...args: unknown[]) => void);
    if (idx !== -1) set.splice(idx, 1);
    if (set.length === 0) listeners.delete(event);
  };

  const emit = <K extends keyof Events>(event: K, ...args: Events[K]) => {
    const set = listeners.get(event);
    if (!set) return;
    // Iterate over a snapshot so listeners can unsubscribe during emit.
    for (const listener of [...set]) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  };

  const clear = <K extends keyof Events>(event?: K) => {
    if (event !== undefined) {
      listeners.delete(event);
    } else {
      listeners.clear();
    }
  };

  return { on, once, off, emit, clear };
}