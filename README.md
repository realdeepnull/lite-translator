# lite-translator

Privacy-friendly, local, offline-capable translation library for the browser.
Translation text never leaves the user's device — no cloud APIs, no remote servers.

- **Core**: `@lite-translator/core` — dependency-free API + engine interface.
- **Engine**: `@lite-translator/engine-onnx` — local machine translation via Transformers.js (ONNX) in a Web Worker.

## Status

**0.2.1** — performance release: 5.5× faster batch translation, WASM by default, single-notify i18n updates.

| Capability                                              | Status |
| ------------------------------------------------------- | ------ |
| Core API + engine interface                             | ✅     |
| DE ↔ EN, FR ↔ EN, ES ↔ EN, IT ↔ EN, NL ↔ EN             | ✅     |
| Debug output via `onDebug`                              | ✅     |
| `capabilities()` engine introspection                   | ✅     |
| Model cache cleanup via `removeModel()`                 | ✅     |
| Lazy loading, progress events, offline cache            | ✅     |
| Web Worker inference (UI stays responsive)              | ✅     |
| Batch translation (`translateBatch`)                    | ✅     |
| WASM by default, opt-in WebGPU acceleration             | ✅     |
| Live translation (incremental, debounced)               | ✅     |
| i18n-style batch translation (`t()` + `translateAll()`) | ✅     |
| Quality suite + benchmarks                              | ✅     |

See the full [Roadmap](docs/ROADMAP.md) for details and the per-step history.

## What's new in 0.2.1

- **5.5× faster batch translation** — translating many texts at once now takes a fraction of the time.
- **Runs predictably everywhere** — the engine uses the CPU by default.
- **Reliable output on short texts** — single words and UI labels no longer produce endless or nonsensical output, and respond faster.
- **Smoother UI updates** — translating all registered strings at once refreshes the page a single time instead of once per string.
- **Faster model checks** — checking whether a model is already downloaded, and detecting GPU support, got noticeably quicker.
- **Clearer performance insights** — new debug events show how long the model itself takes, separate from other overhead.

## What's new in 0.2.0

- Structured debug events with `onDebug` for lifecycle, timing and engine diagnostics.
- `capabilities()` to inspect the resolved runtime setup (device, dtype, model metadata).
- `removeModel()` to remove cached model artifacts from browser Cache Storage.
- Better engine compatibility with optional debug hooks and non-breaking API extension.

## Demo

<table>
  <tr>
    <td align="center"><img src="docs/gifs/output_vid1_max.gif" alt="Batch translation demo" width="280" /></td>
    <td align="center"><img src="docs/gifs/output_vid2_max.gif" alt="Live translation demo" width="280" /></td>
    <td align="center"><img src="docs/gifs/output_vid3_max.gif" alt="Mulit translation demo" width="280" /></td>
  </tr>
</table>

## Install

```sh
npm install @lite-translator/core @lite-translator/engine-onnx
```

## Quickstart

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

## Features at a glance

### Batch translation

Translate many texts in a single inference call — one tokenization, encoder
and decoder pass for the whole batch instead of N roundtrips.

```ts
const results = await translator.translateBatch(["Hallo Welt", "Guten Morgen"]);
console.log(results.map((r) => r.text)); // ["Hello World", "Good morning"]
```

### Live translation

Translate incrementally while the user types (chat) or while speech-to-text
streams words in. Input is segmented at sentence boundaries; completed
sentences are cached and only the still-growing tail is re-translated.

```ts
const live = translator.createLiveSession({ debounce: 250 });

live.on("translation", (event) => {
  console.log(event.text); // full translation
  console.log(event.partial); // still-growing tail
});

live.update("Hallo wie geht");
```

See [docs/live-translation.md](docs/live-translation.md).

### i18n-style translation

Register UI strings with `t(key, text)` across components, then translate all
of them in one `translateAll()` call — one inference pass, no race conditions.

```ts
const t = translator.t();

t("header.title", "Willkommen");
t("footer.button", "Bestätigen");

await translator.translateAll(); // 1 translateBatch → 1 inference call
t("header.title"); // → "Welcome"
```

See [docs/i18n-style-batch-translation.md](docs/i18n-style-batch-translation.md).

## Documentation

- [Roadmap](docs/ROADMAP.md) — timeline, principles, per-step status
- [API reference](docs/api.md)
- [Language selection](docs/language-selection.md)
- [WebGPU acceleration](docs/webgpu-acceleration.md)
- [Live translation](docs/live-translation.md)
- [i18n-style batch translation](docs/i18n-style-batch-translation.md)

## Integration Guides

- [HTML / Vanilla JavaScript](docs/integration-html.md)
- [React 18](docs/integration-react.md)
- [Vue 3](docs/integration-vue.md)
- [Angular 22](docs/integration-angular.md)

## License

MIT
