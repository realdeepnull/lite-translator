# lite-translator

Privacy-friendly, local, offline-capable translation library for the browser.

- **Core**: `@lite-translator/core` — dependency-free API + engine interface.
- **Engine**: `@lite-translator/engine-onnx` — local machine translation via Transformers.js in a Web Worker.

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

## Status

MVP / pre-0.1. Expect breaking changes.

See [docs/ROADMAP.md](docs/ROADMAP.md).

## Integration Guides

- [HTML / Vanilla JavaScript](docs/integration-html.md)
- [React 18](docs/integration-react.md)
- [Vue 3](docs/integration-vue.md)
- [Angular 22](docs/integration-angular.md)

## License

MIT
