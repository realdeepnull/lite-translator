# Debug Output

Lite Translator provides structured debug events via an opt-in `onDebug`
callback. When present, the library emits typed lifecycle, timing, and
engine-internal events that you can log, display in a dev panel, or collect
for performance analysis.

## Enabling debug events

Pass `onDebug` when creating a translator:

```ts
import { createTranslator, type DebugEvent } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const engine = createOnnxEngine();

const translator = await createTranslator({
  from: "de",
  to: "en",
  engines: [engine],
  onDebug: (event: DebugEvent) => {
    console.debug(`[${event.type}]`, event);
  },
});
```

The callback is **opt-in** — when `onDebug` is omitted, there is zero
overhead (no events are constructed or emitted).

## Event types

Every event carries a `timestamp` (from `performance.now()`) and a `type`
discriminator. The events are grouped into three categories:

### Load lifecycle

| Event | Fields | When |
|---|---|---|
| `load-start` | `pair`, `timestamp` | Before `preload()` / first `translate()` starts model download |
| `load-done` | `pair`, `durationMs`, `timestamp` | After the model is loaded and ready |

### Translation timing

| Event | Fields | When |
|---|---|---|
| `translate-start` | `pair`, `inputLength`, `timestamp` | Before a single `translate()` call |
| `translate-done` | `pair`, `durationMs`, `inputLength`, `outputLength`, `timestamp` | After the translation completes |
| `batch-start` | `pair`, `batchSize`, `timestamp` | Before `translateBatch()` |
| `batch-done` | `pair`, `durationMs`, `batchSize`, `timestamp` | After the batch completes |
| `translateall-start` | `pair`, `keyCount`, `timestamp` | Before `translateAll()` |
| `translateall-done` | `pair`, `durationMs`, `keyCount`, `uniqueCount`, `timestamp` | After all keys are translated |
| `abort` | `pair`, `timestamp` | When an already-aborted `AbortSignal` is detected |

### Engine internals (engine-onnx only)

| Event | Fields | When |
|---|---|---|
| `worker-spawn` | `engine`, `timestamp` | When a new Web Worker is created |
| `worker-error` | `engine`, `message`, `timestamp` | When the worker reports an error |
| `device-resolved` | `engine`, `device`, `dtype`, `timestamp` | After device/dtype resolution (e.g. `"wasm"`/`"bnb4"`) |
| `device-fallback` | `engine`, `from`, `to`, `timestamp` | When WebGPU fails and the engine falls back to WASM |

## Usage example: timing panel

```ts
const events: DebugEvent[] = [];

const translator = await createTranslator({
  from: "de",
  to: "en",
  engines: [engine],
  onDebug: (e) => events.push(e),
});

await translator.preload();
await translator.translate("Hallo Welt");

// Inspect timing
const loadTime = events.find((e) => e.type === "load-done")?.durationMs;
const translateTime = events.find((e) => e.type === "translate-done")?.durationMs;

console.log(`Model load: ${loadTime}ms`);
console.log(`Translation: ${translateTime}ms`);
```

## Type reference

```ts
type DebugEvent =
  | { type: "load-start"; timestamp: number; pair: LanguagePair }
  | { type: "load-done"; timestamp: number; pair: LanguagePair; durationMs: number }
  | { type: "translate-start"; timestamp: number; pair: LanguagePair; inputLength: number }
  | { type: "translate-done"; timestamp: number; pair: LanguagePair; durationMs: number; inputLength: number; outputLength: number }
  | { type: "batch-start"; timestamp: number; pair: LanguagePair; batchSize: number }
  | { type: "batch-done"; timestamp: number; pair: LanguagePair; durationMs: number; batchSize: number }
  | { type: "translateall-start"; timestamp: number; pair: LanguagePair; keyCount: number }
  | { type: "translateall-done"; timestamp: number; pair: LanguagePair; durationMs: number; keyCount: number; uniqueCount: number }
  | { type: "abort"; timestamp: number; pair: LanguagePair }
  | { type: "worker-spawn"; timestamp: number; engine: string }
  | { type: "worker-error"; timestamp: number; engine: string; message: string }
  | { type: "device-resolved"; timestamp: number; engine: string; device: string; dtype: string }
  | { type: "device-fallback"; timestamp: number; engine: string; from: string; to: string };
```