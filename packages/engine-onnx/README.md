# @lite-translator/engine-onnx

[![npm version](https://img.shields.io/npm/v/@lite-translator/engine-onnx)](https://www.npmjs.com/package/@lite-translator/engine-onnx)
[![License: MIT](https://img.shields.io/npm/l/@lite-translator/engine-onnx)](https://github.com/realdeepnull/lite-translator/blob/main/LICENSE)

> Local machine-translation engine for [lite-translator](https://github.com/realdeepnull/lite-translator),
> powered by [Transformers.js](https://huggingface.co/docs/transformers.js) in a Web Worker.

Part of [lite-translator](https://github.com/realdeepnull/lite-translator). This package provides the ONNX/Transformers.js engine implementation. Pair it with [`@lite-translator/core`](https://www.npmjs.com/package/@lite-translator/core) for the engine-independent API.

## Features

- Quantized OPUS-MT models for `de ↔ en`, `fr ↔ en`, `es ↔ en`, `it ↔ en`, `nl ↔ en` (loaded from the Hugging Face Hub)
- Inference runs in a Web Worker (UI stays responsive)
- Models are cached in the browser (Cache Storage) and work offline after the first download
- **WASM inference by default** (predictable latency everywhere); **WebGPU acceleration** opt-in with automatic WASM fallback

## Install

```sh
npm install @lite-translator/core @lite-translator/engine-onnx
```

## Usage

```ts
import { createTranslator } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const translator = await createTranslator({
  from: "de",
  to: "en",
  engines: [createOnnxEngine()],
  onProgress: (e) => console.log(e.phase, e.progress),
});

const result = await translator.translate("Hallo Welt");
console.log(result.text); // "Hello World"
await translator.dispose();
```

### Batch translation

`translateBatch` sends all texts to the worker in a single roundtrip and uses
Transformers.js native batching (`pipe([...])`) — one tokenization, encoder and
decoder pass for the whole batch. Inputs are sorted by text length so each
chunk contains similar-length texts (ONNX pads every sequence to the longest
in its chunk — this minimizes wasted padding tokens). Chunks are bounded by
both a text limit and a character budget to keep memory pressure low.
Result order always matches input order; empty strings are passed through.

```ts
const results = await translator.translateBatch(["Hallo Welt", "Guten Morgen"]);
console.log(results.map((r) => r.text)); // ["Hello World", "Good morning"]
```

The engine downloads models lazily on first use. To preload explicitly, call `await translator.preload()`.

### WebGPU acceleration

The engine runs on WASM by default (`device: "wasm"`, dtype `bnb4`) —
predictable latency in every environment, no GPU probing. WebGPU is opt-in:

```ts
// Default: WASM (bnb4)
const engine = createOnnxEngine();

// Opt-in: WebGPU if an adapter is available, else WASM
const engine = createOnnxEngine({ device: "auto" });

// Force WebGPU (throws if unavailable)
const engine = createOnnxEngine({ device: "webgpu" });

// Force WASM (explicit)
const engine = createOnnxEngine({ device: "wasm" });

// Override dtype (optional)
const engine = createOnnxEngine({ device: "auto", dtype: "bnb4" });
```

| Device   | Default dtype | Notes                                                                                                                              |
| -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `webgpu` | `bnb4`        | Same reliable quantization as WASM, with GPU acceleration. `fp16` produces empty/garbage output for short strings (UI labels, single words) — avoid unless you only translate long sentences. `fp32` works but downloads are ~2× larger and slower. |
| `wasm`   | `bnb4`        | Safe default; `fp32` triggers `ShapeInferenceError`, `q8`/`int8`/`uint8`/`q4` trigger `MatMulNBits` regression                      |

After loading, the resolved device and dtype are available via `capabilities()`:

```ts
const engine = createOnnxEngine();
const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
await translator.preload();
console.log(engine.capabilities());
// { engine: "onnx", device: "wasm", dtype: "bnb4", modelId: "onnx-community/opus-mt-de-en" }
// with device: "auto" and a GPU adapter: { engine: "onnx", device: "webgpu", dtype: "bnb4", modelId: "..." }
```

## Supported language pairs

The default registry ships quantized OPUS-MT models for the following pairs.
Each pair is demand-loaded on first use and cached for offline access.

| Pair    | Default model ID               |
| ------- | ------------------------------ |
| `de-en` | `onnx-community/opus-mt-de-en` |
| `en-de` | `onnx-community/opus-mt-en-de` |
| `fr-en` | `onnx-community/opus-mt-fr-en` |
| `en-fr` | `onnx-community/opus-mt-en-fr` |
| `es-en` | `onnx-community/opus-mt-es-en` |
| `en-es` | `onnx-community/opus-mt-en-es` |
| `it-en` | `onnx-community/opus-mt-it-en` |
| `en-it` | `onnx-community/opus-mt-en-it` |
| `nl-en` | `onnx-community/opus-mt-nl-en` |
| `en-nl` | `onnx-community/opus-mt-en-nl` |

Any other pair throws `LANGUAGE_PAIR_NOT_SUPPORTED` at translator creation.

### Custom models

Override the default mapping via `createOnnxEngine({ models })` or pass a fully
custom registry via `createOnnxEngine({ registry })`:

```ts
const engine = createOnnxEngine({
  models: {
    "de-en": "onnx-community/opus-mt-de-en",
    "en-de": "onnx-community/opus-mt-en-de",
    "fr-en": "onnx-community/opus-mt-fr-en",
  },
});
```

Each model ID can also be set through the matching `VITE_MODEL_ID_*` environment
variable, which takes precedence over the built-in default.

## Related

- [GitHub repository](https://github.com/realdeepnull/lite-translator)
- [Roadmap](https://github.com/realdeepnull/lite-translator/blob/main/docs/ROADMAP.md)
- [API reference](https://github.com/realdeepnull/lite-translator/blob/main/docs/api.md)
- [WebGPU acceleration](https://github.com/realdeepnull/lite-translator/blob/main/docs/webgpu-acceleration.md)
- [Integration guides](https://github.com/realdeepnull/lite-translator#integration-guides)
- [Core package: @lite-translator/core](https://www.npmjs.com/package/@lite-translator/core)
