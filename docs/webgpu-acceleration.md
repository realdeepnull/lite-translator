# WebGPU Acceleration

Lite Translator uses the GPU for faster inference when the browser supports
WebGPU, and automatically falls back to WASM when it does not. The selection
happens at model load time — no configuration is required for the default case.

## Default behavior (`device: "auto"`)

```ts
import { createTranslator } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const engine = createOnnxEngine(); // device: "auto" (default)

const translator = await createTranslator({
  from: "de",
  to: "en",
  engines: [engine],
});

await translator.preload();
console.log(engine.capabilities());
// { device: "webgpu", dtype: "fp16" } — GPU available with shader-f16
// { device: "webgpu", dtype: "fp32" } — GPU available, no shader-f16
// { device: "wasm",    dtype: "bnb4" } — no GPU
```

The engine probes `navigator.gpu` and calls `requestAdapter()`. If an adapter
is returned and supports the `shader-f16` feature, WebGPU with `fp16` is
selected. If an adapter exists but lacks `shader-f16`, WebGPU with `fp32` is
used. If no adapter is available (or `navigator.gpu` is absent), the engine
falls back to WASM with `bnb4` quantization.

### Why `bnb4` on WASM?

Transformers.js v4 ships with `onnxruntime-web`, which has a known
[MatMulNBits regression](https://github.com/huggingface/transformers.js/issues/1635)
affecting `q8`, `int8`, `uint8`, `q4`, and `q4f16` dtypes on **both** backends.
`fp32` triggers a separate `ShapeInferenceError` on WASM. `bnb4` (BitsAndBytes
4-bit) uses a different ONNX op graph that avoids both bugs and is the only
proven-working quantized dtype on WASM.

## Forcing a device

```ts
// Always use WebGPU; throws if unavailable
const engine = createOnnxEngine({ device: "webgpu" });

// Always use WASM (e.g. for testing or predictable behavior)
const engine = createOnnxEngine({ device: "wasm" });
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
// WebGPU with fp32 (e.g. for maximum accuracy)
const engine = createOnnxEngine({ device: "webgpu", dtype: "fp32" });

// WASM with bnb4 (explicit)
const engine = createOnnxEngine({ device: "wasm", dtype: "bnb4" });

// q4f16 — accepted but may trigger MatMulNBits bug
const engine = createOnnxEngine({ device: "webgpu", dtype: "q4f16" });
```

When `dtype` is omitted, the engine picks a safe default for the resolved
device:

| Device  | Default dtype | Fallback dtype      |
| ------- | ------------- | ------------------- |
| webgpu  | `fp16`        | `fp32` (no shader-f16) |
| wasm    | `bnb4`        | —                   |

`q4f16` is accepted as an explicit override but excluded from auto-selection
because it uses MatMulNBits ops. A console warning is emitted when `q4f16` is
selected.

## Inspecting the resolved configuration

```ts
const engine = createOnnxEngine();

// Before load — resolution is lazy (WebGPU probing is async)
engine.capabilities(); // { device: "auto", dtype: "auto" }

await translator.preload();

// After load — concrete values
engine.capabilities(); // { device: "webgpu", dtype: "fp16" }
```

`capabilities()` is engine-only (on `TransformersEngine`). It is not part of
the core `TranslationEngine` interface.

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