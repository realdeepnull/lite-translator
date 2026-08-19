# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
