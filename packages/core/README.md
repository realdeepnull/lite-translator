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

## API

- `createTranslator(options)` — creates a translator (no model download on import)
- `translator.preload()` — explicitly preloads the model
- `translator.translate(text)` — translates text (lazy-loads the model)
- `translator.isReady()` — model loaded and ready
- `translator.isCached()` — model present in local cache (offline-capable)
- `translator.dispose()` — frees resources

See the [repository](../../README.md) for the full documentation.