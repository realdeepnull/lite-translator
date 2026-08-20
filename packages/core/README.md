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

## API

- `createTranslator(options)` — creates a translator (no model download on import)
- `translator.preload()` — explicitly preloads the model
- `translator.translate(text)` — translates text (lazy-loads the model)
- `translator.translateBatch(texts)` — translates multiple texts in one call
  (batched by the engine; result order matches input order)
- `translator.t()` — returns a bound `t(key, text?)` function for i18n-style
  registration and reading of UI strings
- `translator.translateAll()` — translates all strings registered via `t()`
  in one `translateBatch()` call; updates the store and notifies subscribers
- `translator.store()` — the reactive `TranslationStore` backing `t()` (created
  lazily on first `t()` call; `undefined` before that)
- `translator.isReady()` — model loaded and ready
- `translator.isCached()` — model present in local cache (offline-capable)
- `translator.dispose()` — frees resources

### Custom engines

Implement the `TranslationEngine` interface (including `translateBatch`).
Engines that only implement `translate()` can be wrapped with
`withBatchFallback(engine)` to get a safe sequential `translateBatch`.

> **Breaking change in 0.1.0:** `translateBatch` is now a required member of
> `TranslationEngine`. Update custom engines or wrap them with
> `withBatchFallback`.

See the [repository](../../README.md) for the full documentation.