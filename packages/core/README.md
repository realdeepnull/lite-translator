# @lite-translator/core

[![npm version](https://img.shields.io/npm/v/@lite-translator/core)](https://www.npmjs.com/package/@lite-translator/core)
[![License: MIT](https://img.shields.io/npm/l/@lite-translator/core)](https://github.com/realdeepnull/lite-translator/blob/main/LICENSE)

> Dependency-free, privacy-friendly translation API for the browser.
> Translation text never leaves the user's device — no cloud, no servers.

Part of [lite-translator](https://github.com/realdeepnull/lite-translator) — a small, offline-capable browser translation library. This package provides the engine-independent core API. Pair it with [`@lite-translator/engine-onnx`](https://www.npmjs.com/package/@lite-translator/engine-onnx) for local ONNX/Transformers.js inference.

## Install

```sh
npm install @lite-translator/core @lite-translator/engine-onnx
```

## Quickstart

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

## Features

### Batch translation

Translate many texts in a single inference call — one tokenization, encoder
and decoder pass for the whole batch instead of N roundtrips.

```ts
const results = await translator.translateBatch([
  "Hallo Welt",
  "Guten Morgen",
  "Wie geht es dir?",
]);
// results[i].text corresponds to input i (order preserved, empty strings kept)
```

### i18n-style translation

Register UI strings across components with `t(key, text)`, then translate all
of them in one `translateAll()` call — one inference pass, no race conditions.

```ts
const t = translator.t();

// Component A
t("header.title", "Willkommen"); // registers, returns "Willkommen"
t("header.subtitle", "Bitte wählen");

// Component B
t("footer.button", "Bestätigen");

// One click — one inference call for all registered strings
await translator.translateAll();

t("header.title"); // → "Welcome" (translated)
t("footer.button"); // → "Confirm" (translated)
```

The store is reactive: frameworks bind via `subscribe()` / `snapshot()` and
re-render automatically. Identical values are deduplicated before inference.
→ [Full guide](https://github.com/realdeepnull/lite-translator/blob/main/docs/i18n-style-batch-translation.md)

### Live translation

Incremental translation for chat or speech-to-text. Input is segmented at
sentence boundaries; completed sentences are cached and only the still-growing
tail is re-translated.

```ts
const live = translator.createLiveSession({ debounce: 250 });

live.on("translation", (e) => {
  console.log(e.text); // full translation
  console.log(e.partial); // still-growing tail
});

live.update("Hallo wie geht");
```

→ [Full guide](https://github.com/realdeepnull/lite-translator/blob/main/docs/live-translation.md)

## API

| Export | Description |
| --- | --- |
| `createTranslator(options)` | Creates a translator (no model download on import) |
| `translator.translate(text, options?)` | Translates text; `options.signal` for `AbortSignal` cancellation |
| `translator.translateBatch(texts, options?)` | Translates multiple texts in one call (order preserved) |
| `translator.preload()` | Explicitly preloads the model |
| `translator.t()` | Returns bound `t(key, text?)` for i18n-style registration |
| `translator.translateAll(options?)` | Translates all `t()`-registered strings in one `translateBatch()` |
| `translator.createLiveSession(options?)` | Creates a `LiveSession` for incremental live translation |
| `translator.store()` | Reactive `TranslationStore` backing `t()` (lazy, `undefined` before first `t()`) |
| `translator.isReady()` | Model loaded and ready |
| `translator.isCached()` | Model present in local cache (offline-capable) |
| `translator.dispose()` | Frees resources |
| `TranslatorPool` | Manages translators by language pair with LRU eviction (`maxSize`) |
| `formatTranslatorError(err)` | Formats any error into a consistent human-readable string |
| `isTranslatorError(err)` | Type guard for `TranslatorError` |
| `withBatchFallback(engine)` | Wraps an engine without `translateBatch` with a sequential fallback |

### Custom engines

Implement the `TranslationEngine` interface (including `translateBatch`).
Engines that only implement `translate()` can be wrapped with
`withBatchFallback(engine)`.

> **Breaking in 0.1.0:** `translateBatch` is now a required member of
> `TranslationEngine`. Update custom engines or wrap them with
> `withBatchFallback`.

## Links

- [GitHub repository](https://github.com/realdeepnull/lite-translator)
- [Roadmap](https://github.com/realdeepnull/lite-translator/blob/main/docs/ROADMAP.md)
- [API reference](https://github.com/realdeepnull/lite-translator/blob/main/docs/api.md)
- [Integration guides](https://github.com/realdeepnull/lite-translator#integration-guides)
- [Engine package: @lite-translator/engine-onnx](https://www.npmjs.com/package/@lite-translator/engine-onnx)
