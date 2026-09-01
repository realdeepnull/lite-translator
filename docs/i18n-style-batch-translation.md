# i18n-Style Batch Translation

`@lite-translator/core` provides an i18n-style API for translating many UI
strings across components in a single inference call. Instead of managing
`translateBatch()` arrays manually, each component registers its strings with
a single `t(key, text)` call; one `translateAll()` translates everything at
once — one model pass, no race conditions.

This document explains the concept independently of any framework. For
concrete integration code, see the framework guides:

- [integration-angular.md](integration-angular.md)
- [integration-react.md](integration-react.md)
- [integration-vue.md](integration-vue.md)
- [integration-html.md](integration-html.md)

---

## Why i18n-style?

A typical app has dozens of short strings spread across many components —
titles, button labels, descriptions, placeholders. Translating them one by one
with `translate()` means N sequential inference calls. Translating them with
`translateBatch()` per component means overlapping `pipe()` calls and race
conditions unless you queue manually.

The i18n-style pattern solves this with a **central store** inside core:

| Approach | Race condition? | Inference calls | Complexity |
| --- | --- | --- | --- |
| Each component calls `translateBatch()` individually | ⚠️ yes — overlapping `pipe()` | N (one per component) | high — queue required |
| `t()` + `translateAll()`, one `translateBatch()` | ✅ no — single call | **1** (for all components) | low |

Components register strings during render; a single `translateAll()` collects
all registered values, deduplicates identical ones, sends them in one
`translateBatch()` to the engine, and writes the results back to the store.
Frameworks react to the store update and re-render automatically.

---

## The two public methods

### `translator.t()`

Returns a bound `t(key, text?)` function. It is overloaded by argument count:

- **`t("my.key", "Hallo")`** — registers the key with its original text.
  Returns the original text **synchronously** so the first paint shows the
  source language immediately.
- **`t("my.key")`** — reads the current value. Before `translateAll()` this is
  the original text; after `translateAll()` it is the translation. If the key
  was never registered, the key itself is returned (i18n fallback convention,
  avoids `undefined` in templates).

```ts
const t = translator.t();

t("header.title", "Willkommen");   // → "Willkommen" (registers, returns original)
t("header.title");                  // → "Willkommen" (reads current value)
// …after translateAll()…
t("header.title");                  // → "Welcome"   (reads translation)
```

### `translator.translateAll()`

Translates all strings registered via `t()` in a single `translateBatch()`
call. After resolving, the store is updated with the translated values and
all subscribers are notified. Loads the model lazily on first call. If no
strings are registered, it is a no-op (no engine call).

```ts
await translator.translateAll();
```

---

## The store: `TranslationStore`

The reactive store lives inside core — the application has no framework
dependency from core. It is created lazily on the first `t()` call and is
scoped to the translator instance (one store per language pair).

### Key methods

| Method | Description |
| --- | --- |
| `register(key, text)` | Stores `key → text` as the original value, notifies subscribers, returns `text`. |
| `get(key)` | Returns the current value (`undefined` if never registered). |
| `set(key, translated)` | Overwrites the value with a translation and notifies subscribers (single update). |
| `setMany(entries)` | Batch version of `set()`: sets multiple `[key, translated]` pairs and notifies subscribers **exactly once** — the batch-update path used by `translateAll()`. An empty iterable does not notify. |
| `original(key)` | Returns the original text (never changes after `register`). |
| `entries()` | Iterator over all `[key, value]` pairs (insertion order). |
| `subscribe(listener)` | Registers a change listener, returns an unsubscribe function. |
| `snapshot()` | Returns a plain `Record<string, string>` snapshot — cached and frozen: repeated calls without an intervening `register()` / `set()` / `clear()` return the **same reference**, so frameworks can compare with `===` instead of shallow-equal. |
| `clear()` | Removes all keys (optional, e.g. on language switch). |
| `size` | Number of registered keys. |

### Reactive binding per framework

Core provides only `subscribe()` + `snapshot()`. Each framework binds this to
its own reactivity primitive. Since `snapshot()` returns a cached, referentially
stable object (frozen), frameworks can compare with `===` — no shallow-equal
workarounds needed.

| Framework | Binding |
| --- | --- |
| Angular | `signal()` mirroring `store.snapshot()`, updated in the `subscribe` callback |
| React | `useSyncExternalStore(store.subscribe, store.snapshot)` — snapshot is stable, no shallow-equal needed |
| Vue | `reactive()` snapshot, refreshed in the `subscribe` callback |
| Vanilla JS | `store.subscribe()` → direct DOM updates |

See the integration guides linked at the top for full code examples.

---

## How `translateAll()` works internally

1. **Collect** all `[key, value]` pairs from the store.
2. **Deduplicate** values with a `Set` — identical source strings share one
   inference. If three buttons all say "Abbrechen", the engine receives it
   once.
3. **Call** `engine.translateBatch(uniqueValues, pair, options)` — exactly
   one inference call for the whole app.
4. **Map back** each unique value to its translation, then batch-update every
   key that originally held that value via `store.setMany()` — one write for
   all keys.
5. **Notify** subscribers **exactly once** — `setMany()` fires a single
   notification for the whole update, so framework bindings (React
   `useSyncExternalStore`, Vue watchers, Angular signals) re-render once
   per `translateAll()` call, not once per key.

```
t("a", "Abbrechen")
t("b", "Abbrechen")
t("c", "Willkommen")
        ↓ translateAll()
unique = ["Abbrechen", "Willkommen"]        ← deduplicated
        ↓ engine.translateBatch(unique)
["Cancel", "Welcome"]
        ↓ map back by value
store.setMany([["a","Cancel"], ["b","Cancel"], ["c","Welcome"]])
        ↓ store.subscribe fires — exactly once
frameworks re-render
```

---

## Lifecycle and scoping

- **One store per translator.** `t()` is bound to the translator's language
  pair (`from`/`to`). Multiple language pairs require multiple translator
  instances, each with its own store. Use `TranslatorPool` to manage multiple
  pairs with LRU eviction (see below).
- **Synchronous first render.** `t(key, text)` returns the original text
  immediately — no `await`, no loading state on first paint. The model loads
  only when `translateAll()` is called.
- **Lazy model load.** `translateAll()` loads the model on first call (like
  `translate()` / `translateBatch()`). Subsequent calls reuse the loaded
  model.
- **AbortSignal.** `translateAll()` accepts an optional `AbortSignal` via
  `TranslateOptions`. When already aborted, it rejects with
  `TRANSLATION_FAILED` ("Translation aborted").
- **Disposal.** `translator.dispose()` clears the store and terminates the
  engine. After disposal, `t()` and `translateAll()` throw `TranslatorError`.

### TranslatorPool (multi-language)

When switching between multiple language pairs at runtime, use
`TranslatorPool` instead of managing a `Map<string, Translator>` manually.
`switchTo(from, to)` returns a cached translator instantly when available;
an optional `maxSize` enables LRU eviction.

```ts
import { TranslatorPool } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const pool = new TranslatorPool({
  engines: [createOnnxEngine()],
  maxSize: 3, // optional: dispose oldest translator beyond this limit
});

const t1 = await pool.switchTo("de", "en");
const t2 = await pool.switchTo("en", "de");
const t1Again = await pool.switchTo("de", "en"); // same instance as t1

await pool.dispose(); // disposes all cached translators
```

---

## When to use which API

| Use case | API |
| --- | --- |
| Translate one string on demand | `translator.translate(text)` |
| Translate a known array of strings | `translator.translateBatch(texts)` |
| Translate many UI strings across components, one click | `t()` + `translateAll()` |
| Reactive templates that update after translation | `t()` + `translateAll()` + framework binding |

The i18n-style API is **additive** — `translate()` and `translateBatch()`
remain unchanged and fully supported. Use `t()` / `translateAll()` when you
want the central-store pattern; use `translateBatch()` directly when you
already have an array of strings.

---

## Error handling

`translateAll()` wraps engine errors in `TranslatorError` with
`ERROR_CODES.TRANSLATION_FAILED`, consistent with `translateBatch()`. Existing
`TranslatorError` instances from the engine pass through unchanged (e.g.
`OFFLINE_MODEL_MISSING`). Use `formatTranslatorError()` for consistent
human-readable error strings across all frameworks.

```ts
import { formatTranslatorError } from "@lite-translator/core";

try {
  await translator.translateAll();
} catch (err) {
  console.error(formatTranslatorError(err));
  // → "Fehler: OFFLINE_MODEL_MISSING: offline" or "Fehler: boom"
}
```