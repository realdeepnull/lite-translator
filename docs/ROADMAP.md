# Roadmap

Lite Translator is a small, local, offline-capable browser library. The core remains engine-independent; models and runtimes are loaded only when needed.

## Principles

- Translation text never leaves the browser.
- External translation providers, Google Translate, cloud APIs, and cloud fallbacks are excluded.
- The Fast Path remains usable without any Smart Path dependency.
- No model is embedded in the core bundle.
- New language pairs and engines must not break the public API.

## Timeline

The following timeline combines phases and releases into a single chronological sequence. Each step carries a status reflecting the current code state.

Legend: ✅ done · 🟡 partial · ⬜ open

---

### Step 1 — Foundation

**Status:** ✅ Done

A clean, publishable TypeScript project without translation functionality.

- npm-workspaces monorepo with `@lite-translator/core` and `@lite-translator/engine-onnx`
- TypeScript, ESM, build (tsdown), types and bundling
- Linting (ESLint + typescript-eslint), formatting (Prettier), unit tests (Vitest), CI
- `AGENTS.md`, `README.md`, license
- knip, size-limit, publint, attw

---

### Step 2 — Core API & Engine Interface

**Status:** ✅ Done

A small public API and a runtime-independent engine contract.

```ts
const translator = await createTranslator({
  from: "de",
  to: "en",
});

const result = await translator.translate("Hallo Welt");
console.log(result.text);
```

Implemented:

- `createTranslator()`, `Translator`, `TranslationResult`
- language pairs, error classes and defined error codes
- `preload()`, `isReady()`, `isCached()`, `dispose()`
- `TranslationEngine` with `supports()`, `isCached()`, `load()`, `translate()`, `dispose()`

The core does not know about any concrete ML runtime.

---

### Step 3 — DE ↔ EN Fast Path

**Status:** ✅ Done

Local translation between German and English in the browser.

- `de → en` and `en → de`
- quantized OPUS-MT models via Transformers.js
- tokenizer, runtime, inference and output normalization integrated
- browser test translates "Hallo Welt" locally
- core ~1 kB gzip

**Milestone:** `"Hallo Welt"` is translated completely locally.

---

### Step 4 — Model Registry

**Status:** ✅ Done

Models are not hard-coded into application logic.

- `ModelDescriptor` (id, version, engine, engineModelId, files, metadata)
- `ModelFile` (url, size, sha256)
- `ModelRegistry` / `StaticModelRegistry`
- `createStaticRegistry()` and `preloadRegistry()`

```ts
{
  "de-en": {
    id: "tiny-de-en-v1",
    version: "1.0.0",
    engine: "onnx",
    files: []
  }
}
```

---

### Step 5 — Lazy Loading & Downloads

**Status:** ✅ Done

Keep the import small, no automatic model downloads.

- model/runtime are loaded only on `preload()`/`translate()`
- progress events via `onProgress`
- downloads from the Hugging Face Hub
- interrupted downloads are handled via Transformers.js cache storage

```ts
const translator = await createTranslator({
  from: "de",
  to: "en",
  onProgress(progress) {
    console.log(progress);
  },
});
```

---

### Step 6 — Cache & Offline Operation

**Status:** ✅ Done

Translation without a network connection after the first download.

- persistent cache via browser Cache Storage
- `isCached()`
- clear `OFFLINE_MODEL_MISSING` error when offline
- `removeModel()` deliberately deferred (optional)

---

### Step 7 — Web Worker

**Status:** ✅ Done

Keep the UI responsive during inference.

- worker lifecycle management
- request IDs and sequential processing
- error propagation
- `dispose()` cleanup in `TransformersEngine`/`worker.ts`

---

### Step 8 — Quality & Benchmarks

**Status:** ✅ Done

Make quality, size and performance measurable.

- quality suite with curated de→en cases: chat, UI, technical text, numbers, negations, typos, colloquial language, idioms, long sentences, incomplete live input (`bench/quality/`)
- critical-failure checks: flipped/lost negation, dropped/changed numbers, omitted/empty/reversed output
- CI gate: `npm run test:quality` fails on translation regressions
- benchmark suite: cold start, first translation, warm translation (median / p95 / mean), model size via Cache Storage (`bench/benchmark/`)
- bundle-size script: core + engine-onnx gzip sizes via Node (`bench:bundle`)
- report output: `bench/report/benchmark-<ISO>.json` + `bench/report/summary.md` (gitignored)
- memory usage deliberately excluded (non-standard `performance.memory`, unreliable across browsers)

---

### Step 9 — Batch Translation

**Status:** ✅ Done

`translateBatch()` as a prerequisite for v0.1.

- `translateBatch()` on `Translator` and `TranslationEngine`
- native ONNX-worker batching with a safe sequential fallback
- stable ordering, empty-input support, bounded batches or chunking
- full compatibility with single-text `translate()`

---

### Step 10 — Live Translation

**Status:** ⬜ Open

Translation while typing without unnecessary inference.

```ts
const live = translator.createLiveSession({ debounce: 250 });

live.on("translation", (result) => {
  console.log(result.text);
});

live.update("Hallo wie geht es dir?");
```

- `createLiveSession()` is not yet implemented
- batching of input, discarding outdated results, avoiding identical requests
- optional simple segmentation; token streaming not required

---

### Step 11 — Release v0.1

**Status:** 🟡 Partial

MVP release: local translation `de ↔ en` with full lifecycle.

Done:

- TypeScript API, engine abstraction, `de ↔ en`, local inference
- lazy loading, model cache, offline, web worker
- `translate()`, `preload()`, `dispose()`, progress events, error codes
- basic tests and browser demo

Missing:

- `translateBatch()` (Step 9)
- live translation (Step 10)

---

### Step 12 — Developer Experience (v0.2)

**Status:** 🟡 Partial

Better debug output, cache management and integration.

Done:

- integration examples for Vanilla JS, React, Vue and Angular

Missing:

- debug output
- `capabilities()`
- cache management
- performance metrics
- better live sessions
- `AbortSignal`
- Svelte example

---

### Step 13 — More Languages (v0.3)

**Status:** ⬜ Open

Additional language pairs after German/English are stable.

- only `de ↔ en` registered; no other language pairs
- planned: `FR ↔ EN`, `ES ↔ EN`, `IT ↔ EN`, `NL ↔ EN`
- models remain demand-loaded

---

### Step 14 — Engine Ecosystem (v0.4)

**Status:** 🟡 Partial

Additional local engines without changing the public API.

Done:

- `@lite-translator/engine-onnx` exists

Missing:

- another local engine package (e.g. `@lite-translator/engine-wasm`)

```text
@lite-translator/core
@lite-translator/engine-wasm
@lite-translator/engine-onnx
```

---

### Step 15 — Evaluate Smart Path (v0.5)

**Status:** ⬜ Open

An optional Smart Path as a separate local engine.

- not yet started
- e.g. a small local LLM or a larger local MT model
- must never be required by the Fast Path
- provider APIs and cloud fallbacks remain excluded

---

### Step 16 — WebGPU Acceleration (v0.6)

**Status:** ⬜ Open

Use the GPU for faster inference when the browser supports WebGPU, with automatic fallback to WASM.

- capability detection: check `navigator.gpu` availability before selecting the device
- `device: "webgpu"` with `dtype: "fp16"` or `dtype: "q4f16"` when WebGPU is available
- automatic fallback to `device: "wasm"` + `dtype: "fp32"` when WebGPU is unavailable or adapter creation fails
- expose selected device/dtype via `capabilities()` or progress metadata
- validate WebGPU support in the browser test environment (Playwright `--enable-unsafe-webgpu` flag or manual testing in a real browser)
- benchmark comparison: WebGPU vs. WASM inference latency

```ts
// Planned: automatic device selection
const engine = createOnnxEngine({
  device: "auto", // "webgpu" if available, else "wasm"
});
```

- `createOnnxEngine({ device: "auto" | "webgpu" | "wasm" })` — default `"auto"`

---

### Step 17 — Release 1.0

**Status:** ⬜ Open

Stable API and engine contracts, multiple language pairs, reproducible benchmarks.

- stable API and engine contracts
- multiple language pairs
- reproducible benchmarks
- offline, cache management, worker support, live translation
- good browser compatibility
- no transmission of translation text

## MVP Milestone

```bash
npm install @lite-translator/core
```

```ts
import { createTranslator } from "@lite-translator/core";

const translator = await createTranslator({ from: "de", to: "en" });
const result = await translator.translate("Hallo Welt");
console.log(result.text);
```

Translation runs locally, works offline after setup, and does not transmit input text to external systems.
