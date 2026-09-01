# WebGPU Acceleration

Lite Translator can use the GPU for faster inference when the browser supports
WebGPU, and automatically falls back to WASM when it does not. **WASM is the
default** — WebGPU is opt-in via `device: "auto"` or `device: "webgpu"`.

## Default behavior (`device: "wasm"`)

```ts
import { createTranslator } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const engine = createOnnxEngine(); // device: "wasm" (default), dtype: "bnb4"

const translator = await createTranslator({
  from: "de",
  to: "en",
  engines: [engine],
});

await translator.preload();
console.log(engine.capabilities());
// { engine: "onnx", device: "wasm", dtype: "bnb4", modelId: "onnx-community/opus-mt-de-en" }
```

WASM needs no probing, runs in every environment, and has predictable latency.
For the small autoregressive OPUS-MT models with typical (short) inputs it is
usually as fast as — often faster than — WebGPU (see
[Why WASM by default?](#why-wasm-by-default)).

## Opting into WebGPU (`device: "auto"`)

```ts
const engine = createOnnxEngine({ device: "auto" });
```

The engine probes `navigator.gpu` and calls `requestAdapter()`. If an adapter
is returned, WebGPU with `bnb4` is selected; otherwise the engine falls back
to WASM (also `bnb4`). The adapter probe is memoized — `requestAdapter()`
can take tens of milliseconds, so it runs **once per page lifetime** instead
of once or twice per `load()`. Repeated calls (including from
`detectWebGpu()` / `isFp16Supported()`) reuse the cached promise.

`fp16` is accepted as an explicit dtype override but is never auto-selected:
it produces empty or garbage output for short strings (UI labels, single
words). `fp32` works but roughly doubles the model download.

### Why `bnb4` on both devices?

Transformers.js v4 ships with `onnxruntime-web`, which has a known
[MatMulNBits regression](https://github.com/huggingface/transformers.js/issues/1635)
affecting `q8`, `int8`, `uint8`, `q4`, and `q4f16` dtypes on **both** backends.
`fp32` triggers a separate `ShapeInferenceError` on WASM. `bnb4` (BitsAndBytes
4-bit) uses a different ONNX op graph that avoids both bugs and is the only
proven-working quantized dtype on WASM. The same reasoning applies to WebGPU:
`fp16` — the natural GPU choice — produces empty or garbage output for short
strings because the decoder hallucinates repetitions and punctuation streams.
`bnb4` works reliably on both devices.

## Why WASM by default?

- **Predictability** — identical behavior and latency in every environment: no
  adapter probing, no per-GPU variance, no surprises in headless browsers or CI.
- **Autoregressive decoding** — OPUS-MT/MarianMT generates one token per decoder
  step across many small sequential ops. The per-step GPU dispatch overhead
  often outweighs the compute speedup for typical (short) inputs; WebGPU mainly
  wins on long texts and large batches.
- **Cold start** — the first WebGPU run includes runtime shader compilation,
  which adds noticeable latency to the first translation.
- **Correctness** — `bnb4`, the only proven-reliable quantized dtype, works on
  WASM; `fp16`, the classic WebGPU dtype, hallucinates on short strings.

## Forcing a device

```ts
// WASM (the default) — explicit form
const engine = createOnnxEngine({ device: "wasm" });

// WebGPU if available, else WASM
const engine = createOnnxEngine({ device: "auto" });

// Always use WebGPU; throws if unavailable
const engine = createOnnxEngine({ device: "webgpu" });
```

When `device: "webgpu"` is set explicitly and WebGPU is not available,
`preload()` throws an error. There is no fallback — the user asked for WebGPU
specifically.

When `device: "auto"` resolves to `"webgpu"` but the worker fails during
pipeline creation (e.g. adapter creation succeeds but inference fails at
runtime), the engine retries **once** with `wasm`/`bnb4` before propagating the
error. Explicit `device: "webgpu"` does not retry.

## Forcing a dtype

```ts
// WebGPU with fp16 — only for long, sentence-like inputs
const engine = createOnnxEngine({ device: "webgpu", dtype: "fp16" });

// WebGPU with fp32 (e.g. for maximum accuracy)
const engine = createOnnxEngine({ device: "webgpu", dtype: "fp32" });

// WASM with bnb4 (explicit)
const engine = createOnnxEngine({ device: "wasm", dtype: "bnb4" });

// q4f16 — accepted but may trigger MatMulNBits bug
const engine = createOnnxEngine({ device: "webgpu", dtype: "q4f16" });
```

`fp16` requires the adapter's `shader-f16` feature and is **not recommended**
for general use: it produces empty or garbage output for short strings (UI
labels, single words). Prefer the default (`bnb4`) unless you exclusively
translate long sentences. `fp32` works reliably but doubles the model
download size.

When `dtype` is omitted, the engine picks the safe default for the resolved
device:

| Device  | Default dtype | Notes                                                                     |
| ------- | ------------- | ------------------------------------------------------------------------- |
| webgpu  | `bnb4`        | `fp16` hallucinates on short inputs; `fp32` works but ~2× larger download |
| wasm    | `bnb4`        | Only proven-working quantized dtype on v4's onnxruntime-web               |

`q4f16` is accepted as an explicit override but excluded from auto-selection
because it uses MatMulNBits ops. A console warning is emitted when `q4f16` is
selected.

## Inspecting the resolved configuration

```ts
const engine = createOnnxEngine();

// Before load — nothing resolved yet
engine.capabilities(); // { engine: "onnx" }

await translator.preload();

// After load — concrete values (default engine: wasm/bnb4)
engine.capabilities(); // { engine: "onnx", device: "wasm", dtype: "bnb4", modelId: "..." }
```

`capabilities()` is available on both the `TransformersEngine` and the
`Translator` (via `translator.capabilities()`). It returns a
`TranslationCapabilities` object with optional `device`, `dtype`, and
`modelId` fields. Before load, only `{ engine: "onnx" }` is returned.

## Browser support

WebGPU is available in Chromium-based browsers (Chrome, Edge, Opera) and
recent Safari/Firefox versions. As of 2026, global support is ~80%+
([caniuse.com/webgpu](https://caniuse.com/webgpu)). In environments without
WebGPU — headless browsers, older browsers, CI runners without GPU — the
engine transparently falls back to WASM.

## Testing

Browser tests use conditional skip (`it.runIf`) based on `navigator.gpu`
availability. WebGPU-specific tests run only in environments with a GPU; they
are skipped (not failed) in headless CI. No `--enable-unsafe-webgpu` flag or
SwiftShader dependency is required.

```ts
// Skipped in CI (no GPU), runs locally with GPU
it.runIf(webgpuAvailable)("device: 'webgpu' loads with GPU", async () => {
  const engine = createOnnxEngine({ device: "webgpu" });
  // ...
});
```

## Model files

Each dtype maps to a different ONNX file suffix on the Hugging Face Hub:

| Dtype | Encoder file                  | Decoder file                          |
| ----- | ------------------------------ | ------------------------------------- |
| fp16  | `encoder_model_fp16.onnx`      | `decoder_model_merged_fp16.onnx`      |
| fp32  | `encoder_model.onnx`           | `decoder_model_merged.onnx`           |
| bnb4  | `encoder_model_bnb4.onnx`      | `decoder_model_merged_bnb4.onnx`      |
| q4f16 | `encoder_model_q4f16.onnx`     | `decoder_model_merged_q4f16.onnx`     |

When switching devices (e.g. from WASM to WebGPU), the engine downloads the
appropriate model files on first use. `isCached()` checks the correct URLs
based on the resolved dtype after load. Before load, it uses the registry's
default file list (`bnb4`).