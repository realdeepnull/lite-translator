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

## API

- `createTranslator(options)` — creates a translator (no model download on import)
- `translator.preload()` — explicitly preloads the model
- `translator.translate(text)` — translates text (lazy-loads the model)
- `translator.translateBatch(texts)` — translates multiple texts in one call
  (batched by the engine; result order matches input order)
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