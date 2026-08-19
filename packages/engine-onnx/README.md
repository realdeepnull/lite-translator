# @lite-translator/engine-onnx

Local machine-translation engine for lite-translator, powered by [Transformers.js](https://huggingface.co/docs/transformers.js) in a Web Worker.

- Quantized OPUS-MT models for `de ↔ en` (loaded from the Hugging Face Hub)
- Inference runs in a Web Worker (UI stays responsive)
- Models are cached in the browser (Cache Storage) and work offline after the first download

## Usage

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

### Batch translation

`translateBatch` sends all texts to the worker in a single roundtrip and uses
Transformers.js native batching (`pipe([...])`) — one tokenization, encoder and
decoder pass for the whole batch. Batches larger than 32 texts are chunked to
bound memory pressure.

```ts
const results = await translator.translateBatch(["Hallo Welt", "Guten Morgen"]);
console.log(results.map((r) => r.text)); // ["Hello World", "Good morning"]
```

The engine downloads models lazily on first use. To preload explicitly, call `await translator.preload()`.