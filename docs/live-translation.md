# Live Translation

`@lite-translator/core` provides a live translation session that translates
**while the user types** — for chat messages or speech-to-text, where words
stream in incrementally and the translation should "grow" with the input.

Instead of translating the whole text on every keystroke (expensive and
flickery), the session **segments** the input at sentence boundaries,
**caches** translations of completed sentences, and only re-translates the
still-growing tail. Outdated results are discarded automatically.

---

## Why a live session?

Two real-world scenarios benefit from incremental translation:

| Scenario | Input pattern | What the session does |
| --- | --- | --- |
| **Chat** | User types a message character by character | Debounces keystrokes, translates once typing pauses |
| **Speech-to-Text** | Words stream in from a recognizer, sentence by sentence | Completed sentences are cached; only the active fragment is re-translated |

Translating the entire text on every keystroke means N inference calls for a
message of N characters. The live session reduces this to one call per debounce
window, and reuses cached sentence translations across updates.

---

## The public API

### `translator.createLiveSession(options?)`

Creates a `LiveSession` bound to the translator's language pair.

```ts
const live = translator.createLiveSession({ debounce: 250 });

live.on("translation", (event) => {
  console.log(event.text);    // full translation
  console.log(event.partial); // still-growing tail
});

live.update("Hallo wie geht");
```

### `LiveSession`

| Method | Description |
| --- | --- |
| `on(event, listener)` | Subscribes to `translation`, `error`, or `dispose`. Returns an unsubscribe function. |
| `once(event, listener)` | Subscribes for a single invocation. |
| `off(event, listener)` | Removes a listener. |
| `update(text)` | Schedules a debounced translation. Identical consecutive inputs are skipped. |
| `clear()` | Clears the segment cache — for a new chat message or speech turn. |
| `dispose()` | Stops pending work, releases the emitter. The session can no longer be used. |

### `LiveTranslationEvent`

Emitted by the `translation` event:

```ts
interface LiveTranslationEvent {
  /** Full translated text: all complete segments joined with the partial. */
  text: string;
  /** The original input string, verbatim. */
  source: string;
  /** Translation of the last, still-growing segment (empty when fully complete). */
  partial: string;
  /** All segments in order, with translations and completeness flag. */
  segments: LiveSegment[];
}

interface LiveSegment {
  source: string;       // original segment text
  translation: string;  // translated text (empty until translated)
  complete: boolean;    // ends at a sentence boundary (cached, stable)
}
```

---

## How it works

### Segmentation

The input is split at sentence boundaries (`.`, `!`, `?`, `;`, newlines). All
segments except the last are **complete** — they end at a boundary. The last
segment is the **partial** — the still-growing tail.

```
"Hallo. Wie geht"  →  complete: ["Hallo."]   partial: "Wie geht"
"Hallo. "          →  complete: ["Hallo."]   partial: ""
```

### Segment cache

Complete segments are translated **once** and cached
(`Map<source, translation>`). On subsequent `update()` calls, only segments
that are not yet in the cache (plus the partial) are sent to
`translateBatch()`. This keeps already-finished sentences stable while the
active fragment adapts live.

### Discard-by-sequence

Every `update()` increments a monotonic sequence number. When an async
`translateBatch()` resolves, the result is discarded if a newer `update()`
has arrived in the meantime. No stale data reaches the UI.

### Identical-input skip

If `update()` is called with the same text as the last call, inference is
skipped entirely — useful when a speech recognizer emits the same partial
recognition twice.

---

## Chat example

```ts
const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
await translator.preload();

const live = translator.createLiveSession({ debounce: 250 });
live.on("translation", (e) => {
  document.getElementById("output").textContent = e.text;
});

// Wire to a textarea's input event.
textarea.addEventListener("input", () => {
  live.update(textarea.value);
});
```

## Speech-to-Text example

```ts
const live = translator.createLiveSession({ debounce: 300 });
live.on("translation", (e) => {
  // Completed sentences stay stable; the active fragment updates live.
  stableArea.textContent = e.segments
    .filter((s) => s.complete)
    .map((s) => s.translation)
    .join(" ");
  partialArea.textContent = e.partial;
});

// As the recognizer emits words, feed them in.
recognizer.onresult = (text) => {
  live.update(text); // e.g. "Hallo. Wie geht es" → "Hallo." cached, "Wie geht es" partial
};
```

---

## Clearing context

When a new chat message or speech turn begins, call `clear()` to reset the
segment cache so previous context does not influence further translations:

```ts
// User starts a new message — discard previous context.
live.clear();
live.update(newMessage);
```

---

## Lifecycle

- A `LiveSession` is created from a `Translator` and shares its engine/model.
- Call `dispose()` when the session is no longer needed (e.g. component
  unmount). This cancels pending debounced work and releases the emitter.
- After `dispose()`, calling `update()` or `on()` throws a `TranslatorError`
  with code `TRANSLATION_FAILED`.
- Disposing the parent `Translator` does **not** automatically dispose live
  sessions — dispose them explicitly to avoid dangling timers.

---

## Framework integration

For concrete integration code (Angular Signals, React hooks, Vue composables,
vanilla HTML), see the framework guides:

- [integration-angular.md](integration-angular.md)
- [integration-react.md](integration-react.md)
- [integration-vue.md](integration-vue.md)
- [integration-html.md](integration-html.md)