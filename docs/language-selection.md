# Language Selection

Lite Translator ships quantized OPUS-MT models for several language pairs. Each
pair is registered in the default ONNX registry and demand-loaded on first use.

## Supported language pairs

| Source | Target | Pair key | Default model ID                  |
|--------|--------|----------|-----------------------------------|
| de     | en     | `de-en`  | `onnx-community/opus-mt-de-en`    |
| en     | de     | `en-de`  | `onnx-community/opus-mt-en-de`    |
| fr     | en     | `fr-en`  | `onnx-community/opus-mt-fr-en`    |
| en     | fr     | `en-fr`  | `onnx-community/opus-mt-en-fr`    |
| es     | en     | `es-en`  | `onnx-community/opus-mt-es-en`    |
| en     | es     | `en-es`  | `onnx-community/opus-mt-en-es`    |
| it     | en     | `it-en`  | `onnx-community/opus-mt-it-en`    |
| en     | it     | `en-it`  | `onnx-community/opus-mt-en-it`    |
| nl     | en     | `nl-en`  | `onnx-community/opus-mt-nl-en`    |
| en     | nl     | `en-nl`  | `onnx-community/opus-mt-en-nl`    |

The pair key follows the pattern `from-to` (lowercase ISO 639-1 codes joined by
a hyphen). It is normalized by [`languagePairKey()`][registry] in
`@lite-translator/core`.

## How selection works

1. The caller creates a translator with `{ from, to }`:

   ```ts
   const translator = await createTranslator({
     from: "fr",
     to: "en",
     engines: [createOnnxEngine()],
   });
   ```

2. `createTranslator` asks each engine whether it `supports(pair)`.
3. The ONNX engine checks its registry: if a model descriptor exists for the
   pair key and the descriptor's `engine` matches, the pair is supported.
4. If no engine supports the pair, `createTranslator` throws
   `LANGUAGE_PAIR_NOT_SUPPORTED` immediately — before any model download.

## Unsupported pairs

Pairs not listed above are not registered by default. Attempting to create a
translator for such a pair fails fast:

```ts
await createTranslator({
  from: "de",
  to: "fr", // not registered
  engines: [createOnnxEngine()],
});
// → throws LANGUAGE_PAIR_NOT_SUPPORTED
```

To add a custom pair, override the default model mapping or pass a fully custom
registry (see [Custom models](#custom-models)).

## Custom models

Override the default mapping via `createOnnxEngine({ models })`:

```ts
const engine = createOnnxEngine({
  models: {
    "de-en": "onnx-community/opus-mt-de-en",
    "en-de": "onnx-community/opus-mt-en-de",
    "de-fr": "onnx-community/opus-mt-de-fr", // custom pair
    "fr-de": "onnx-community/opus-mt-fr-de",
  },
});
```

Each model ID can also be set through the matching `VITE_MODEL_ID_*` environment
variable, which takes precedence over the built-in default:

| Env variable            | Pair  |
|-------------------------|-------|
| `VITE_MODEL_ID_DE_EN`   | `de-en` |
| `VITE_MODEL_ID_EN_DE`   | `en-de` |
| `VITE_MODEL_ID_FR_EN`   | `fr-en` |
| `VITE_MODEL_ID_EN_FR`   | `en-fr` |
| `VITE_MODEL_ID_ES_EN`   | `es-en` |
| `VITE_MODEL_ID_EN_ES`   | `en-es` |
| `VITE_MODEL_ID_IT_EN`   | `it-en` |
| `VITE_MODEL_ID_EN_IT`   | `en-it` |
| `VITE_MODEL_ID_NL_EN`   | `nl-en` |
| `VITE_MODEL_ID_EN_NL`   | `en-nl` |

For a fully custom registry, pass `createOnnxEngine({ registry })` instead.

## Demand loading and caching

No model is embedded in the bundle. On first `translate()` or `preload()` for a
pair, the engine downloads the quantized ONNX files from the Hugging Face Hub
and caches them in the browser's Cache Storage. Subsequent uses — including
offline — load from cache without network access.

Each translator instance is bound to exactly one language pair (`from`/`to`).
Multiple simultaneous pairs require multiple translator instances.

## See also

- [packages/engine-onnx/src/models.ts](../packages/engine-onnx/src/models.ts) — default registry
- [packages/core/src/registry.ts](../packages/core/src/registry.ts) — pair key helpers and registry API
- [packages/core/src/translator.ts](../packages/core/src/translator.ts) — `LANGUAGE_PAIR_NOT_SUPPORTED` path
- [docs/ROADMAP.md](ROADMAP.md) — Step 12 (More Languages)

[registry]: ../packages/core/src/registry.ts