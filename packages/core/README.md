# @lite-translator/core

Dependency-free core API for lite-translator: local, offline-capable, privacy-friendly translation in the browser.

## Usage

```ts
import { createTranslator } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const translator = await createTranslator({
  from: "de",
  to: "en",
  engines: [createOnnxEngine()],
});

const result = await translator.translate("Hallo Welt");
console.log(result.text);
await translator.dispose();
```

### Batch translation

```ts
const results = await translator.translateBatch([
  "Hallo Welt",
  "Guten Morgen",
  "Wie geht es dir?",
]);
// results[i].text corresponds to input i (order preserved, empty strings kept)
```

### i18n-style batch translation

For UI strings spread across many components, use `t()` + `translateAll()`.
Each component registers its strings with a single `t(key, text)` call; one
`translateAll()` translates everything in a **single** inference call — no
race conditions, no per-component arrays.

```ts
const t = translator.t();

// Component A
t("header.title", "Willkommen");       // registers, returns "Willkommen"
t("header.subtitle", "Bitte wählen");

// Component B
t("footer.button", "Bestätigen");

// One click — one inference call for all registered strings
await translator.translateAll();

t("header.title");  // → "Welcome" (translated)
t("footer.button");  // → "Confirm" (translated)
```

The store is reactive: frameworks bind to `translator.store()` via
`subscribe()` / `snapshot()` and re-render automatically after `translateAll()`.
Identical values are deduplicated before inference. See
[i18n-style batch translation](../../docs/i18n-style-batch-translation.md) for
the full guide and framework integration examples.

### Live translation

For chat messages or speech-to-text, `createLiveSession()` translates
incrementally as the user types. Input is segmented at sentence boundaries;
completed sentences are cached and only the still-growing tail is
re-translated on each `update()`. Outdated results are discarded automatically.

```ts
const live = translator.createLiveSession({ debounce: 250 });

live.on("translation", (e) => {
  console.log(e.text);    // full translation
  console.log(e.partial); // still-growing tail
});

live.update("Hallo wie geht");
```

See [live translation](../../docs/live-translation.md) for the full guide.

## API

- `createTranslator(options)` — creates a translator (no model download on import)
- `translator.preload()` — explicitly preloads the model
- `translator.translate(text, options?)` — translates text (lazy-loads the model);
  `options.signal` accepts an `AbortSignal` to cancel the translation
- `translator.translateBatch(texts, options?)` — translates multiple texts in one call
  (batched by the engine; result order matches input order; `options.signal` for cancellation)
- `translator.t()` — returns a bound `t(key, text?)` function for i18n-style
  registration and reading of UI strings
- `translator.translateAll(options?)` — translates all strings registered via `t()`
  in one `translateBatch()` call; updates the store and notifies subscribers
  (`options.signal` for cancellation)
- `translator.createLiveSession(options?)` — creates a `LiveSession` for
  incremental live translation (chat / speech-to-text); segments input,
  caches completed sentences, discards outdated results
- `translator.store()` — the reactive `TranslationStore` backing `t()` (created
  lazily on first `t()` call; `undefined` before that). `snapshot()` returns a
  cached, frozen reference so frameworks can compare with `===` (no shallow-equal
  workaround needed)
- `translator.isReady()` — model loaded and ready
- `translator.isCached()` — model present in local cache (offline-capable)
- `translator.dispose()` — frees resources
- `TranslatorPool` — manages multiple translators by language pair with
  LRU eviction (`maxSize`); `switchTo(from, to)` returns a cached translator
  instantly when available
- `formatTranslatorError(err)` — formats any error (`TranslatorError` or
  arbitrary) into a consistent human-readable string
- `isTranslatorError(err)` — type guard for `TranslatorError`
- `withBatchFallback(engine)` — wraps an engine without `translateBatch` with a
  sequential fallback

### Custom engines

Implement the `TranslationEngine` interface (including `translateBatch`).
Engines that only implement `translate()` can be wrapped with
`withBatchFallback(engine)` to get a safe sequential `translateBatch`.

> **Breaking change in 0.1.0:** `translateBatch` is now a required member of
> `TranslationEngine`. Update custom engines or wrap them with
> `withBatchFallback`.

See the [repository](../../README.md) for the full documentation.