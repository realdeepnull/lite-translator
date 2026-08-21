# @lite-translator/engine-onnx

Local machine-translation engine for lite-translator, powered by [Transformers.js](https://huggingface.co/docs/transformers.js) in a Web Worker.

- Quantized OPUS-MT models for `de ↔ en`, `fr ↔ en`, `es ↔ en`, `it ↔ en`, `nl ↔ en` (loaded from the Hugging Face Hub)
- Inference runs in a Web Worker (UI stays responsive)
- Models are cached in the browser (Cache Storage) and work offline after the first download
- **WebGPU acceleration** with automatic WASM fallback (Step 10)

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
decoder pass for the whole batch. Batches larger than 32 texts are chunked to
bound memory pressure.

```ts
const results = await translator.translateBatch(["Hallo Welt", "Guten Morgen"]);
console.log(results.map((r) => r.text)); // ["Hello World", "Good morning"]
```

The engine downloads models lazily on first use. To preload explicitly, call `await translator.preload()`.

### WebGPU acceleration

By default the engine uses `device: "auto"`, which probes `navigator.gpu` and
selects WebGPU when a GPU adapter is available, falling back to WASM otherwise.

```ts
// Automatic: WebGPU if available, else WASM (default)
const engine = createOnnxEngine();

// Force WebGPU (throws if unavailable)
const engine = createOnnxEngine({ device: "webgpu" });

// Force WASM
const engine = createOnnxEngine({ device: "wasm" });

// Override dtype (optional)
const engine = createOnnxEngine({ device: "auto", dtype: "fp32" });
```

| Device   | Default dtype | Notes |
|----------|---------------|-------|
| `webgpu` | `fp16` (or `fp32` when `shader-f16` is unavailable) | Fastest inference |
| `wasm`   | `bnb4` | Safe default; `fp32` triggers `ShapeInferenceError`, `q8`/`int8`/`q4` trigger `MatMulNBits` regression |

After loading, the resolved device and dtype are available via `capabilities()`:

```ts
const engine = createOnnxEngine();
const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
await translator.preload();
console.log(engine.capabilities()); // { device: "webgpu", dtype: "fp16" } or { device: "wasm", dtype: "bnb4" }
```

## Supported language pairs

The default registry ships quantized OPUS-MT models for the following pairs.
Each pair is demand-loaded on first use and cached for offline access.

| Pair    | Default model ID                      |
|---------|----------------------------------------|
| `de-en` | `onnx-community/opus-mt-de-en`         |
| `en-de` | `onnx-community/opus-mt-en-de`         |
| `fr-en` | `onnx-community/opus-mt-fr-en`         |
| `en-fr` | `onnx-community/opus-mt-en-fr`         |
| `es-en` | `onnx-community/opus-mt-es-en`         |
| `en-es` | `onnx-community/opus-mt-en-es`         |
| `it-en` | `onnx-community/opus-mt-it-en`         |
| `en-it` | `onnx-community/opus-mt-en-it`         |
| `nl-en` | `onnx-community/opus-mt-nl-en`         |
| `en-nl` | `onnx-community/opus-mt-en-nl`         |

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