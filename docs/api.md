# API Reference

This document describes the public API of **Lite Translator** — split into the core package (`@lite-translator/core`) and the ONNX engine package (`@lite-translator/engine-onnx`).

---

## Table of Contents

- [Core (`@lite-translator/core`)](#core-lite-translatorcore)
  - [createTranslator](#createtranslator)
  - [Translator](#translator)
  - [TranslationEngine (Interface)](#translationengine-interface)
  - [Engine registration](#engine-registration)
  - [TranslationStore](#translationstore)
  - [TranslatorPool](#translatorpool)
  - [LiveSession](#livesession)
  - [Model Registry](#model-registry)
  - [Emitter](#emitter)
  - [Errors](#errors)
  - [Types](#types)
- [Engine ONNX (`@lite-translator/engine-onnx`)](#engine-onnx-lite-translatorengine-onnx)
  - [createOnnxEngine](#createonnxengine)
  - [WebGPU helper functions](#webgpu-helper-functions)
  - [Default Registry & Model IDs](#default-registry--model-ids)

---

## Core (`@lite-translator/core`)

### createTranslator

```ts
function createTranslator(options: TranslatorOptions): Promise<Translator>
```

Creates a `Translator` for a language pair. Loads **no** model — only on the first `translate()`/`preload()`. Throws `LANGUAGE_PAIR_NOT_SUPPORTED` when no engine supports the pair.

**Parameters — `TranslatorOptions`**

| Field | Type | Required | Description |
|---|---|---|---|
| `from` | `LanguageCode` | yes | Source language (BCP-47-like, e.g. `"de"`) |
| `to` | `LanguageCode` | yes | Target language |
| `onProgress` | `ProgressCallback` | no | Callback for model download/load progress |
| `onDebug` | `DebugCallback` | no | Callback for structured debug events (lifecycle, timing, engine internals). Opt-in, zero overhead when absent. See [docs/debug-output.md](debug-output.md). |
| `engines` | `TranslationEngine[]` | no | Explicit engine list; when omitted, the globally registered defaults are used |

**Example**

```ts
import { createTranslator } from "@lite-translator/core";

const translator = await createTranslator({ from: "de", to: "en" });
const result = await translator.translate("Hallo Welt");
console.log(result.text); // "Hello world"
```

---

### Translator

Represents a bound language pair and the chosen engine. Created via `createTranslator()`.

#### Properties

| Property | Type | Description |
|---|---|---|
| `pair` | `LanguagePair` | Language pair `{ from, to }` (copy) |

#### Methods

##### `preload(): Promise<void>`

Preloads the model. Idempotent — multiple calls result in only one download.

##### `translate(text: string, options?: TranslateOptions): Promise<TranslationResult>`

Translates a single text. Loads the model automatically when needed.

| Parameter | Type | Description |
|---|---|---|
| `text` | `string` | Text to translate |
| `options.signal` | `AbortSignal` | Abort signal; when already aborted, `TRANSLATION_FAILED` is thrown |

**Return value — `TranslationResult`**

| Field | Type | Description |
|---|---|---|
| `text` | `string` | Translated text |
| `from` | `LanguageCode` | Source language |
| `to` | `LanguageCode` | Target language |
| `engine` | `string` | ID of the engine used (e.g. `"onnx"`) |

##### `translateBatch(texts: string[], options?: TranslateOptions): Promise<TranslationResult[]>`

Translates multiple texts in a single call (native batching when the engine supports it). The result order matches the input order; empty strings stay empty.

##### `t(): (key: string, text?: string) => string`

Returns a bound `t()` function for i18n-style batch translation.

- `t("my.key", "Hallo")` → registers the key and returns the original text synchronously.
- `t("my.key")` → returns the current value (translation after `translateAll()`, original before, or the key itself as fallback).

##### `store(): TranslationStore | undefined`

Returns the reactive store behind `t()`. Created lazily on the first `t()` call. Frameworks (Angular, React, Vue) subscribe to it for reactive template updates.

##### `translateAll(options?: TranslateOptions): Promise<void>`

Translates all strings registered via `t()` in a single `translateBatch()` call. After resolving, the store is updated with the translated values and all subscribers are notified. Identical values are deduplicated before inference. No-op when nothing is registered.

##### `createLiveSession(options?: LiveSessionOptions): LiveSession`

Creates a live translation session for incremental input (chat, speech-to-text).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options.debounce` | `number` | `250` | Debounce in milliseconds |

##### `isReady(): boolean`

`true` when the model is loaded and immediately ready to use.

##### `isCached(): Promise<boolean>`

`true` when the model is cached locally (offline use possible).

##### `capabilities(): TranslationCapabilities | undefined`

Returns the engine's resolved capabilities (device, dtype, model ID), or `undefined` when the engine does not implement `capabilities()` or the model has not been loaded yet.

**Return value — `TranslationCapabilities`**

| Field | Type | Description |
|---|---|---|
| `engine` | `string` | Engine ID, e.g. `"onnx"` |
| `device` | `string \| undefined` | Resolved device, e.g. `"webgpu"` or `"wasm"` |
| `dtype` | `string \| undefined` | Resolved data type, e.g. `"fp16"` or `"bnb4"` |
| `modelId` | `string \| undefined` | Engine's model ID |
| `modelVersion` | `string \| undefined` | Model version, if known |

##### `removeModel(): Promise<void>`

Removes the cached model files for this language pair from browser Cache Storage. When the model is currently loaded, it is disposed first — a subsequent `preload()` re-downloads the files.

Throws `ENGINE_NOT_SUPPORTED` when the engine does not implement `removeModel()`.

##### `dispose(): Promise<void>`

Releases engine resources. The translator cannot be used afterward.

---

### TranslationEngine (Interface)

Engine-independent interface. The core knows no concrete implementation.

```ts
interface TranslationEngine {
  readonly id: string;
  supports(pair: LanguagePair): boolean;
  isCached(pair: LanguagePair): Promise<boolean>;
  load(pair: LanguagePair, onProgress?: ProgressCallback, onDebug?: DebugCallback): Promise<void>;
  translate(text: string, pair: LanguagePair, options?: TranslateOptions): Promise<TranslationResult>;
  translateBatch(texts: string[], pair: LanguagePair, options?: TranslateOptions): Promise<TranslationResult[]>;
  capabilities?(): TranslationCapabilities | undefined;
  removeModel?(pair: LanguagePair): Promise<void>;
  dispose(): Promise<void>;
}
```

| Method | Description |
|---|---|
| `id` | Stable engine ID, e.g. `"onnx"` |
| `supports(pair)` | Checks whether the engine supports the language pair |
| `isCached(pair)` | Checks whether the model is cached locally |
| `load(pair, onProgress?, onDebug?)` | Loads model and runtime. Idempotent. |
| `translate(text, pair, options?)` | Translates a text. Lazily loads when needed. |
| `translateBatch(texts, pair, options?)` | Translates multiple texts. Result order = input order. Empty strings stay empty. |
| `capabilities?()` | Optional: returns the resolved capabilities (device, dtype, model). |
| `removeModel?(pair)` | Optional: removes the cached model files for a language pair. |
| `dispose()` | Frees memory and runtime resources |

---

### Engine registration

#### `registerDefaultEngine(engine: TranslationEngine): void`

Registers an engine globally as a default. Duplicates (same `id`) are ignored. Enables convenience packages to register an engine on import.

#### `getDefaultEngines(): readonly TranslationEngine[]`

Returns a copy of the globally registered default engines.

#### `withBatchFallback(engine: TranslationEngine): TranslationEngine`

Wraps an engine so that `translateBatch` is always available. When the engine already implements `translateBatch`, it is returned unchanged. Otherwise a proxy is returned whose `translateBatch` sequentially calls `translate()` for each text.

---

### TranslationStore

Framework-neutral reactive store for i18n-style translation keys. Components register strings via `register(key, text)` and read the current value via `get(key)`.

| Method | Signature | Description |
|---|---|---|
| `register` | `(key: string, text: string): string` | Registers a key with its original text. Returns the text synchronously. |
| `get` | `(key: string): string \| undefined` | Current value; `undefined` when never registered. |
| `set` | `(key: string, translated: string): void` | Sets a translated value (internally by `translateAll()`). |
| `setMany` | `(entries: Iterable<[string, string]>): void` | Sets multiple translated values at once and notifies subscribers **exactly once** (instead of once per key). The batch-update path of `translateAll()`. An empty iterable does not notify. |
| `original` | `(key: string): string \| undefined` | Original text (never changes after `register`). |
| `has` | `(key: string): boolean` | Whether a key is registered. |
| `entries` | `(): IterableIterator<[string, string]>` | All `[key, value]` pairs (insertion order). |
| `keys` | `(): IterableIterator<string>` | All registered keys. |
| `size` | `number` (getter) | Number of registered keys. |
| `subscribe` | `(listener: () => void): () => void` | Subscribes to changes. Returns an unsubscribe function. |
| `snapshot` | `(): Record<string, string>` | Frozen copy of the current state. Cached — repeated calls without a change return the same reference (for `===` comparison in React `useSyncExternalStore`). |
| `clear` | `(): void` | Removes all registered keys. |

---

### TranslatorPool

Reusable pool of translators, keyed by language pair. Replaces the ad-hoc `Map<string, Translator>` pattern. `switchTo(from, to)` returns a cached translator immediately or creates a new one.

#### `TranslatorPoolOptions`

| Field | Type | Description |
|---|---|---|
| `engines` | `TranslationEngine[]` | Explicit engine list; global defaults when omitted |
| `onProgress` | `ProgressCallback` | Forwarded to every created translator |
| `onDebug` | `DebugCallback` | Forwarded to every created translator — one callback collects the `DebugEvent`s of all cached language pairs. Opt-in, zero overhead when absent. |
| `maxSize` | `number` | Max. number of cached translators; LRU eviction when exceeded. Default: unlimited |

#### Methods

| Method | Signature | Description |
|---|---|---|
| `switchTo` | `(from: string, to: string): Promise<Translator>` | Returns the translator for the pair (cached or newly created). |
| `get` | `(from: string, to: string): Translator \| undefined` | Cached translator or `undefined`; does not create a new one. |
| `current` | `(): Translator \| undefined` | The currently cached translator. |
| `cachedPairs` | `(): string[]` | All cached language-pair keys, e.g. `["de-en"]`. |
| `size` | `number` (getter) | Number of cached translators. |
| `disposePair` | `(from, to): Promise<void>` | Disposes a single translator and removes it. |
| `dispose` | `(): Promise<void>` | Disposes all cached translators and empties the pool. |

**Example**

```ts
import { TranslatorPool } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const pool = new TranslatorPool({ engines: [createOnnxEngine()], maxSize: 3 });
const t1 = await pool.switchTo("de", "en");
const t2 = await pool.switchTo("de", "en"); // same instance as t1
await pool.dispose();
```

---

### LiveSession

Live translation session for incremental input (chat typing, speech-to-text). Segments input at sentence boundaries, caches translations of completed sentences, and only re-translates the still-growing tail. Outdated results are discarded automatically.

#### Events (`LiveSessionEvents`)

| Event | Payload | Description |
|---|---|---|
| `translation` | `LiveTranslationEvent` | New (possibly partial) translation available |
| `error` | `TranslatorError` | Translation failed |
| `dispose` | `—` | Session was disposed |

#### Methods

| Method | Signature | Description |
|---|---|---|
| `on` | `(event, listener): () => void` | Subscribes to an event. Returns an unsubscribe function. |
| `once` | `(event, listener): () => void` | Subscribes for a single invocation. |
| `off` | `(event, listener): void` | Removes a listener. |
| `update` | `(text: string): void` | Updates the input and schedules a debounced translation. Identical consecutive inputs are skipped. An empty string clears the session. |
| `clear` | `(): void` | Clears cache and pending state. Emits `translation` with empty content. |
| `dispose` | `(): void` | Cancels pending work and releases the emitter. |
| `disposed` | `boolean` (getter) | Whether the session is disposed. |

#### `LiveTranslationEvent`

| Field | Type | Description |
|---|---|---|
| `text` | `string` | Full translation (all complete segments + partial) |
| `source` | `string` | The original input, verbatim |
| `partial` | `string` | Translation of the last, still-growing segment (empty when fully complete) |
| `segments` | `LiveSegment[]` | All segments with translation and `complete` flag |

#### `LiveSegment`

| Field | Type | Description |
|---|---|---|
| `source` | `string` | Original text of the segment |
| `translation` | `string` | Translation (empty until translated) |
| `complete` | `boolean` | Whether the segment ends at a sentence boundary (cached, stable) |

**Example**

```ts
const live = translator.createLiveSession({ debounce: 250 });
live.on("translation", (e) => console.log(e.text));
live.update("Hallo wie geht");
```

#### `splitSegments(input: string): { complete: string[]; partial: string }`

Exported helper function: splits input into complete segments (at sentence boundaries `.`, `!`, `?`, `;`, newlines) and a partial tail.

---

### Model Registry

#### Types

| Type | Description |
|---|---|
| `ModelFile` | `{ url, size?, sha256? }` — downloadable model file |
| `ModelDescriptor` | `{ id, version, engine, engineModelId?, files, metadata? }` — model description |
| `ModelRegistry` | Interface: `getModel(pair): Promise<ModelDescriptor \| undefined>` |
| `StaticModelRegistry` | Extends `ModelRegistry` with `getModelSync(pair)` for synchronous `supports()` |

#### Functions

| Function | Signature | Description |
|---|---|---|
| `createStaticRegistry` | `(models: Record<string, ModelDescriptor>): StaticModelRegistry` | Creates a simple static registry from a record. |
| `isStaticRegistry` | `(registry: ModelRegistry): registry is StaticModelRegistry` | Type guard for synchronous registries. |
| `languagePairKey` | `(pair: LanguagePair): string` | Language pair → key, e.g. `"de-en"`. |
| `parseLanguagePairKey` | `(key: string): LanguagePair` | Key → `{ from, to }`. |
| `preloadRegistry` | `(registry: ModelRegistry): Promise<StaticModelRegistry>` | Loads an async registry into a static one. |

---

### Emitter

Minimal, framework-neutral, typed event emitter. Pure TypeScript, works in Node and the browser.

```ts
interface Emitter<Events extends ListenerMap> {
  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): () => void;
  once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): () => void;
  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): void;
  emit<K extends keyof Events>(event: K, ...args: Events[K]): void;
  clear<K extends keyof Events>(event?: K): void;
}
```

#### `createEmitter<Events>(): Emitter<Events>`

Creates a new typed emitter. Listeners are called in subscription order; `emit()` is synchronous.

---

### Errors

#### `ERROR_CODES`

Stable error codes for consumers:

| Code | Description |
|---|---|
| `MODEL_NOT_AVAILABLE` | Model not available |
| `MODEL_DOWNLOAD_FAILED` | Model download failed |
| `MODEL_LOAD_FAILED` | Model loading failed |
| `LANGUAGE_PAIR_NOT_SUPPORTED` | No engine supports the language pair |
| `ENGINE_NOT_SUPPORTED` | Engine not supported |
| `OUT_OF_MEMORY` | Out of memory |
| `TRANSLATION_FAILED` | Translation failed (also on abort) |
| `OFFLINE_MODEL_MISSING` | Model not present offline |

#### `TranslatorError extends Error`

| Field | Type | Description |
|---|---|---|
| `code` | `ErrorCode` | Error code from `ERROR_CODES` |
| `name` | `string` | Always `"TranslatorError"` |

#### `isTranslatorError(error: unknown): error is TranslatorError`

Type guard for `TranslatorError`.

#### `formatTranslatorError(err: unknown): string`

Formats any error into a consistent string: `"Fehler: <code>: <message>"` for `TranslatorError`, otherwise `"Fehler: <message>"`.

---

### Types

| Type | Description |
|---|---|
| `LanguageCode` | `string` — BCP-47-like without region, e.g. `"de"` |
| `LanguagePair` | `{ from: LanguageCode; to: LanguageCode }` |
| `ProgressEvent` | `{ phase: string; loaded: number; total: number; progress: number }` |
| `ProgressCallback` | `(event: ProgressEvent) => void` |
| `TranslateOptions` | `{ signal?: AbortSignal }` |
| `TranslatorOptions` | `{ from, to, onProgress?, onDebug?, engines? }` |
| `TranslationCapabilities` | `{ engine: string; device?: string; dtype?: string; modelId?: string; modelVersion?: string }` |
| `DebugEvent` | Discriminated union — structured debug events (lifecycle, timing, engine internals). See [docs/debug-output.md](debug-output.md). |
| `DebugCallback` | `(event: DebugEvent) => void` |
| `LiveSessionOptions` | `{ debounce?: number }` |

---

## Engine ONNX (`@lite-translator/engine-onnx`)

### createOnnxEngine

```ts
function createOnnxEngine(options?: OnnxEngineOptions): TransformersEngine
```

Creates a local ONNX engine (Transformers.js + Web Worker). Default: de-en / en-de (and more) with quantized OPUS-MT models from the HF Hub.

#### `OnnxEngineOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `registry` | `StaticModelRegistry` | `createDefaultRegistry(defaultModelIds)` | Custom static registry |
| `models` | `Record<string, string>` | `defaultModelIds` | Overrides the language-pair→model-ID mapping |
| `device` | `OnnxDevice` | `"wasm"` | Device mode: `"wasm"` (default — predictable CPU inference), `"auto"` (WebGPU if available, else WASM), `"webgpu"` (requires WebGPU) |
| `dtype` | `OnnxDtype` | device-dependent | Dtype override; default: `"bnb4"` on WebGPU and WASM |

**Example**

```ts
import { createOnnxEngine } from "@lite-translator/engine-onnx";
import { registerDefaultEngine } from "@lite-translator/core";

registerDefaultEngine(createOnnxEngine()); // wasm/bnb4 (default)
```

---

### WebGPU helper functions

| Function | Signature | Description |
|---|---|---|
| `detectWebGpu` | `(): Promise<boolean>` | Probes `navigator.gpu` and requests an adapter. `false` on error/unavailability. |
| `isFp16Supported` | `(): Promise<boolean>` | Checks whether the WebGPU adapter supports `shader-f16`. |
| `resolveDeviceDtype` | — | Resolves device + dtype based on capabilities. |

#### Types

| Type | Values | Description |
|---|---|---|
| `OnnxDevice` | `"auto" \| "webgpu" \| "wasm"` | Device selection mode |
| `OnnxDtype` | `"fp16" \| "fp32" \| "bnb4" \| "q4f16" \| "auto"` | Dtype options |
| `ResolvedDevice` | `"webgpu" \| "wasm"` | Concrete device after resolution (never `"auto"`) |
| `ResolvedDtype` | `"fp16" \| "fp32" \| "bnb4" \| "q4f16"` | Concrete dtype after resolution (never `"auto"`) |
| `ResolvedCapabilities` | `{ device: ResolvedDevice; dtype: ResolvedDtype }` | Resolved capabilities |

> **Note:** `"bnb4"` is the proven quantized dtype on onnxruntime-web v4 (`q8`/`int8`/`uint8`/`q4` trigger the MatMulNBits bug; `q4f16` as well — use with caution).

---

### Default Registry & Model IDs

#### `ENGINE_ID`

```ts
const ENGINE_ID = "onnx";
```

Engine ID; used in `TranslationResult.engine`.

#### `defaultModelIds: Record<string, string>`

Default language models (quantized OPUS-MT models from the HF Hub). Keys are language-pair keys (`"de-en"`, `"en-de"`, `"fr-en"`, `"en-fr"`, `"es-en"`, `"en-es"`, `"it-en"`, `"en-it"`, `"nl-en"`, `"en-nl"`). Can be overridden via `createOnnxEngine({ models })` or customized through `VITE_MODEL_ID_*` environment variables.

#### `createDefaultRegistry(modelIds: Record<string, string>): StaticModelRegistry`

Creates the static model registry for the given pair→model-ID entries.