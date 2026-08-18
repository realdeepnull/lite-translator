# Roadmap

## Phase 0 — Foundation

**Goal:** Set up the project cleanly from a technical perspective.

- Initialize the TypeScript project
- Define the npm package structure
- Set up the build system
- ESM support
- Ship TypeScript types
- Linting and formatting
- Unit test setup
- CI for builds and tests
- `AGENTS.md`
- `README.md`
- Define the license
- Finalize package names

**Result:** A publishable npm package with no functionality yet.

---

## Phase 1 — Core API

**Goal:** Define the public API before integrating a concrete ML runtime.

Planned API:

```ts
const translator = await createTranslator({
  from: "de",
  to: "en",
});

const result = await translator.translate(
  "Hallo Welt"
);
```

Implement:

- `createTranslator()`
- `Translator`
- `TranslationResult`
- Language codes
- Error classes
- `dispose()`
- `preload()`
- `isReady()`

Define the engine interface:

```ts
interface TranslationEngine {
  supports(pair: LanguagePair): boolean;

  load(pair: LanguagePair): Promise<void>;

  translate(
    text: string
  ): Promise<TranslationResult>;

  dispose(): Promise<void>;
}
```

**Important:** The core must not know about any concrete runtime.

---

## Phase 2 — First Fast-Path Engine

**Goal:** The first real local translation in the browser.

Only the following language directions will initially be supported:

```text
German → English
English → German
```

Tasks:

- select a suitable tiny MT model
- determine the model format
- choose the runtime
- integrate the tokenizer
- load the model
- implement inference
- normalize the output
- implement error handling

### Target sizes

```text
Model: preferably ~20–30 MB
Core: preferably <100 KB gzip
```

**Milestone:** `"Hallo Welt"` is translated completely locally in the browser.

---

## Phase 3 — Model Registry

**Goal:** Avoid hard-coding models directly in the code.

Example:

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

The registry manages:

- language pair → model
- model version
- download URLs
- file size
- checksums
- engine compatibility
- update strategy

This allows additional language pairs to be added later without changing the core API.

---

## Phase 4 — Lazy Loading & Download

**Goal:** Keep the npm package itself small.

An import:

```ts
import {
  createTranslator
} from "translator-package";
```

must not automatically download a model.

Only when:

```ts
await translator.preload();
```

or:

```ts
await translator.translate(text);
```

are the required runtime and model files loaded.

Implement:

- lazy loading
- model download
- runtime download
- download progress
- handling of interrupted downloads

Example:

```ts
const translator = await createTranslator({
  from: "de",
  to: "en",

  onProgress(progress) {
    console.log(progress);
  }
});
```

---

## Phase 5 — Offline Cache

**Goal:** After the first download, translation should work offline.

Implement:

- persistent model cache
- model versions
- cache invalidation
- detecting existing models
- deleting a model
- offline error states

Possible API:

```ts
await translator.isCached();
```

Later optional:

```ts
await translator.removeModel();
```

### Milestone

1. Download the model
2. Put the browser offline
3. Reload the page
4. Translation continues to work

---

## Phase 6 — Web Worker

**Goal:** Translation work must not block the UI.

Architecture:

```text
Main Thread
     │
     ▼
Web Worker
     │
     ▼
Translation Engine
     │
     ▼
Model
```

Implement:

- worker lifecycle
- worker messaging
- request IDs
- error propagation
- control parallel requests
- release resources with `dispose()`

The application should remain responsive even while a translation is running.

---

## Phase 7 — Live Translation

**Goal:** Enable translation while text is being typed.

Example:

```ts
const live = translator.createLiveSession({
  debounce: 250
});

live.on("translation", result => {
  console.log(result.text);
});

live.update(
  "I wanted to ask whether..."
);
```

Implement:

- debounce
- request cancellation
- return only the newest result
- do not translate identical inputs again
- optionally simple sentence or paragraph segmentation

Real token streaming is not required for the MVP.

---

## Phase 8 — Benchmark & Quality

**Goal:** Make quality, model size, and performance measurable.

### Quality categories

Test cases for:

- normal chats
- UI text
- technical text
- numbers
- negations
- typos
- colloquial speech
- idioms
- ambiguous terms
- long sentences
- incomplete live input

Errors that are especially critical:

```text
❌ Negation changed
❌ Number changed
❌ Text omitted
❌ Meaning reversed
```

### Performance

Measure:

```text
Cold Start
Model Download
Model Initialization
First Translation
Warm Translation
Memory Usage
Core Bundle Size
Model Size
```

The benchmark helps decide which model becomes the default fast path.

---

# Version 0.1.0

The first public npm version should appear when the following features work reliably:

- TypeScript API
- engine abstraction
- German → English
- English → German
- local inference
- lazy loading
- model cache
- offline mode
- web worker
- `translate()`
- `preload()`
- `dispose()`
- progress events
- defined error codes
- basic tests
- browser demo

## Not required for `0.1.0`

- WebLLM
- Smart Path
- automatic language detection
- speech-to-text
- text-to-speech
- cloud APIs
- large universal models
- support for many languages

---

# Version 0.2 — Developer Experience

**Goal:** Improve integration for developers.

Planned:

- better debug output
- `capabilities()`
- extended cache management
- performance metrics
- improved live sessions
- `AbortSignal` support

Example:

```ts
await translator.translate(text, {
  signal
});
```

Additional examples for:

- Vanilla JavaScript
- React
- Vue
- Svelte

---

# Version 0.3 — More Languages

Only after German ↔ English is stable will additional language pairs be added.

For example:

```text
DE ↔ EN
FR ↔ EN
ES ↔ EN
IT ↔ EN
NL ↔ EN
```

Models will still be loaded only when needed.

The goal remains:

```text
small core
     │
     ▼
requested language pair
     │
     ▼
small specialized model
```

Not:

```text
large universal model for all languages
```

---

# Version 0.4 — Engine Ecosystem

**Goal:** Put engine independence to work.

Possible packages:

```text
@translator/core
@translator/engine-wasm
@translator/engine-browser
@translator/engine-onnx
```

The public API stays independent of the engine:

```ts
await translator.translate(text);
```

Alternative engines must not require changes to normal application code.

---

# Version 0.5 — Evaluate Smart Path

Only at that point will we decide whether to add a Smart Path as well.

Possible technologies:

- WebLLM
- Qwen or other small LLMs
- browser-native translator APIs
- larger MT models
- context translation
- glossaries
- translation memory

The Smart Path must be implemented as a separate engine.

```text
Fast Path
    │
    ▼
Tiny MT
~20–30 MB
```

Optional:

```text
Smart Path
    │
    ▼
Context-aware Engine
```

### Core architectural rule

> The Smart Path must never become a dependency of the Fast Path.

The Fast Path must remain independently small, local, and offline-capable.

---

# Version 1.0

`1.0` represents a stable TypeScript library for local, offline-capable, privacy-friendly browser translation with interchangeable engines and a long-term stable API.

For `1.0`, the following should be guaranteed in particular:

- stable public API
- documented engine interface
- multiple language pairs
- reproducible benchmarks
- offline support
- persistent model cache
- cache management
- web worker support
- live translation
- good browser compatibility
- semantic versioning
- no unexpected network requests
- no transmission of translated text

---

# Prioritization

Development ideally proceeds in this order:

```text
1. Core API
      ↓
2. Engine Interface
      ↓
3. DE → EN Fast Path
      ↓
4. EN → DE Fast Path
      ↓
5. Benchmark
      ↓
6. Cache + Offline
      ↓
7. Web Worker
      ↓
8. Live Translation
      ↓
9. npm v0.1
      ↓
10. more languages
      ↓
11. more engines
      ↓
12. optional Smart Path
```

---

# Most important MVP milestone

The most important milestone is a convincing `v0.1`, where a developer needs only a few lines:

```bash
npm install translator-package
```

```ts
import { createTranslator } from "translator-package";

const translator = await createTranslator({
  from: "de",
  to: "en"
});

const result = await translator.translate(
  "Hallo Welt"
);

console.log(result.text);
```

The translation should then happen **locally, offline-capable, and without sending the text to an external server**.