# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Fixed

- `@lite-translator/engine-onnx`: Worker setzt jetzt `env.allowLocalModels = false`.
  Zuvor versuchte Transformers.js, Modell-Dateien unter einem relativen Pfad zur
  Konsumenten-Origin zu laden. Bei SPA-Servern mit HTML-Fallback (z.B. Angular/Vite
  Dev-Server) liefert jede URL `index.html` mit Status 200 zurück, sodass Transformers.js
  dieses HTML als ONNX-Protobuf parsen wollte und mit einem Parsing-Fehler scheiterte.
  Modelle werden nun ausschließlich vom Hugging Face Hub geladen.

### Added

- Initial MVP setup as an npm-workspaces monorepo with two packages:
  - `@lite-translator/core` — dependency-free, engine-agnostic translation API
    - `createTranslator()` with `preload()`, `translate()`, `isReady()`, `isCached()`, `dispose()`
    - `TranslationEngine` interface for pluggable engines
    - Defined error codes (`MODEL_NOT_AVAILABLE`, `MODEL_DOWNLOAD_FAILED`, `MODEL_LOAD_FAILED`,
      `LANGUAGE_PAIR_NOT_SUPPORTED`, `ENGINE_NOT_SUPPORTED`, `OUT_OF_MEMORY`,
      `TRANSLATION_FAILED`, `OFFLINE_MODEL_MISSING`)
    - Model registry abstraction (`ModelRegistry`, `StaticModelRegistry`, `createStaticRegistry`,
      `preloadRegistry`) with exchangeable model URLs
    - No runtime dependencies; core bundle ~1 kB gzipped
  - `@lite-translator/engine-onnx` — local MT engine powered by Transformers.js in a Web Worker
    - Quantized OPUS-MT models for German → English and English → German (loaded from the Hugging Face Hub)
    - Lazy model download with progress events (`onProgress`)
    - Persistent offline cache via browser Cache Storage (works offline after first download)
    - Worker lifecycle management with `dispose()`
- Toolchain: TypeScript, tsdown (ESM + declarations), Vitest (+ Browser Mode with Playwright/Chromium),
  ESLint + typescript-eslint, Prettier, publint, Are The Types Wrong, knip, size-limit
- CI workflow (build, typecheck, lint, knip, unit tests, browser tests)
- Browser demo in [examples/demo/index.html](examples/demo/index.html)
