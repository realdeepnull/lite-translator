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

The engine downloads models lazily on first use. To preload explicitly, call `await translator.preload()`.