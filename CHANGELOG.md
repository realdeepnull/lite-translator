# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **WebGPU acceleration:** `createOnnxEngine({ device: "auto" | "webgpu" | "wasm" })` — 
  default `"auto"`. Probes `navigator.gpu`; selects `webgpu`/`fp16` (or `webgpu`/`fp32`
  without `shader-f16`), falling back to `wasm`/`bnb4`. `capabilities()` on
  `TransformersEngine` exposes the resolved `{ device, dtype }`. WebGPU→WASM
  fallback retry for `device: "auto"`; explicit `"webgpu"` throws if unavailable.
- `detectWebGpu()`, `isFp16Supported()`, `resolveDeviceDtype()` exported.
- Worker protocol: `load` accepts `device`/`dtype`, posts `capabilities` before `loaded`.
- `isCached()` is dtype-aware (`_fp16`/`_bnb4`/unsuffixed ONNX URLs).
- Browser tests with conditional skip (`it.runIf`); benchmark WebGPU vs. WASM
  comparison (`BENCH_RESULT_WEBGPU`); demo shows `capabilities()` in status badge.

### Changed

- `@lite-translator/engine-onnx`: upgraded `@huggingface/transformers` to
  `^4.2.0`, models switched to `onnx-community/opus-mt-*`, default `wasm`+`bnb4`
  (MatMulNBits workaround).

## [0.1.0] — 2026-08-19

### Added

- `translateBatch()` on `Translator` and `TranslationEngine`: translates
  multiple texts in a single call. The ONNX engine uses native Transformers.js
  worker batching (`pipe([...])`) — one tokenization, encoder and decoder pass
  for the whole batch instead of N roundtrips. Result order matches input order;
  empty strings are preserved. Batches larger than 32 texts are chunked to
  bound memory pressure (KV-cache grows with batch × sequence length).
- `withBatchFallback(engine)` helper in `@lite-translator/core`: wraps engines
  that only implement `translate()` with a safe sequential `translateBatch`,
  so third-party engines stay compatible with the 0.1.0 interface.
- Benchmark suite measures `translateBatch()` over the quality-case inputs
  (`batchTranslateMs`, `batchInputsCount` in the report).
- Quality suite has a batch-consistency check comparing `translateBatch` with
  individual `translate()` calls.
- Demo (`examples/demo`) uses a single `translateBatch()` call for the batch
  section instead of sequential per-item translations.

### Changed

- **Breaking:** `translateBatch` is now a required member of the
  `TranslationEngine` interface. Custom engines must implement it or be wrapped
  with `withBatchFallback(engine)`.
- `@lite-translator/core` and `@lite-translator/engine-onnx` bumped to `0.1.0`;
  the engine peer dependency on core is now `^0.1.0`.
- Worker protocol extended: `translate` messages may carry `texts: string[]`
  (batch) in addition to the legacy `text: string`. The worker distinguishes
  via `Array.isArray`; the legacy single-text path remains functional.

## [0.0.1]

### Added

- Quality and benchmark infrastructure in `bench/`:
  - Quality suite (`bench/quality/`): curated de→en cases (chat, UI, technical,
    numbers, negations, typos, colloquial, idioms, long sentences, live input)
    with per-case assertions and critical-failure checks (flipped/lost negation,
    changed numbers, empty/reversed content). CI gate via `npm run test:quality`.
  - Benchmark suite (`bench/benchmark/`): cold start, first/warm translation
    (median/p95/mean), model size via Cache Storage, bundle gzip sizes via Node.
    Reports to `bench/report/` (JSON + Markdown, gitignored).
  - Scripts: `test:quality`, `bench`, `bench:bundle`.
  - CI: `test:quality` as gate; `benchmark` job uploads report artifact.

### Fixed

- `@lite-translator/engine-onnx`: Worker sets `env.allowLocalModels = false`.
  Previously Transformers.js tried loading model files from a relative consumer
  path; SPA servers with HTML fallback returned `index.html` (200), causing an
  ONNX protobuf parse error. Models now load exclusively from the Hugging Face Hub.

### Added

- Initial MVP: npm-workspaces monorepo with two packages.
  - `@lite-translator/core` — dependency-free, engine-agnostic API:
    `createTranslator()` (`preload`, `translate`, `isReady`, `isCached`, `dispose`),
    `TranslationEngine` interface, error codes, model registry
    (`createStaticRegistry`, `preloadRegistry`), core ~1 kB gzip.
  - `@lite-translator/engine-onnx` — Transformers.js in a Web Worker:
    quantized OPUS-MT de↔en, lazy download with `onProgress`, offline cache
    via Cache Storage, `dispose()` lifecycle.
- Toolchain: TypeScript, tsdown, Vitest (+ Browser/Playwright), ESLint, Prettier,
  publint, attw, knip, size-limit.
- CI workflow and browser demo (`examples/demo/index.html`).
