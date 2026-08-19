# Integration: Angular 22

This guide shows how to use `@lite-translator/core` and `@lite-translator/engine-onnx` in an Angular 22 app (Standalone Components, Signals).

## Installation

```sh
npm install @lite-translator/core @lite-translator/engine-onnx
```

## Architecture decision: service instead of direct import

Angular applications should resolve dependencies via DI (Dependency Injection). We encapsulate translator creation in an injectable service. This makes the components testable and engine-independent.

## Step 1: TranslationService

```ts
// src/app/translation.service.ts
import { Injectable, inject, signal } from "@angular/core";
import { createTranslator, type ProgressEvent, type Translator } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

@Injectable({ providedIn: "root" })
export class TranslationService {
  private translator: Translator | null = null;

  /** Progress signal for the UI (0..1) */
  readonly progress = signal(0);

  async create(): Promise<Translator> {
    if (this.translator) return this.translator;
    this.translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [createOnnxEngine()],
      onProgress: (e: ProgressEvent) => {
        if (Number.isFinite(e.progress)) this.progress.set(e.progress);
      },
    });
    return this.translator;
  }

  async isCached(): Promise<boolean> {
    return (await this.translator)?.isCached() ?? false;
  }

  async dispose(): Promise<void> {
    await this.translator?.dispose();
    this.translator = null;
  }
}
```

## Step 2: Standalone component

```ts
// src/app/translator-example.component.ts
import { Component, OnDestroy, inject, signal } from "@angular/core";
import { TranslationService } from "./translation.service";

@Component({
  selector: "app-translator-example",
  standalone: true,
  template: `
    <div style="max-width: 480px; display: grid; gap: 12px">
      <textarea
        [value]="input()"
        (input)="input.set($any($event.target).value)"
        rows="4"
      ></textarea>
      <button [disabled]="loading()" (click)="handleTranslate()">
        {{ loading() ? "Translating…" : "Translate" }}
      </button>
      @if (loading()) {
        <progress max="1" [value]="translation.progress()" style="width: 100%" />
      }
      <output style="white-space: pre-wrap">{{ output() }}</output>
    </div>
  `,
})
export class TranslatorExampleComponent implements OnDestroy {
  protected readonly translation = inject(TranslationService);

  protected readonly input = signal("Hallo Welt, wie geht es dir?");
  protected readonly output = signal("");
  protected readonly loading = signal(false);

  protected async handleTranslate(): Promise<void> {
    this.loading.set(true);
    this.output.set("");
    try {
      const translator = await this.translation.create();
      const result = await translator.translate(this.input());
      this.output.set(result.text);
    } catch (err) {
      this.output.set(`Error: ${(err as { code?: string }).code ?? "UNKNOWN"}`);
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    // Terminate the worker when the component is destroyed
    void this.translation.dispose();
  }
}
```

## Step 3: Register in the router or standalone bootstrap

```ts
// src/app/app.routes.ts
import { Routes } from "@angular/router";
import { TranslatorExampleComponent } from "./translator-example.component";

export const routes: Routes = [{ path: "", component: TranslatorExampleComponent }];
```

## Step 4: Configure the Vite dependency optimizer (angular.json)

The library fix (`dist/worker.js` is self-contained and contains `@huggingface/transformers` inline) makes the worker generally usable. However, it is not sufficient by itself in the Angular dev server: Vite sees `new URL("./worker.js", import.meta.url)`, wants to prebundle the worker into the dependency optimizer directory (`.angular/cache/.../vite/deps/worker.js?worker_file&type=module`), and cannot find it there because it is only resolved at build/asset time.

The error then looks roughly like this:

> The file does not exist at …/vite/deps/worker.js?worker_file&type=module … Try adding it to `optimizeDeps.exclude`.

**Both fixes are required and complement each other:**

| Problem                                                           | Library fix (`noExternal`) | Consumer fix (`optimizeDeps.exclude`) |
| ----------------------------------------------------------------- | -------------------------- | ------------------------------------- |
| `@huggingface/transformers` cannot be prebundled in the worker    | ✅ fixes it                | irrelevant                            |
| Vite cannot find `worker.js` in the deps directory                | ❌ does not fix it         | ✅ fixes it                           |
| `new URL("./worker.js", import.meta.url)` is resolved incorrectly | ❌ does not fix it         | ✅ fixes it                           |

Add the package to `angular.json` under the `build` target of the application builder. In Angular 22 (Vite-based), the option is `optimizeDeps.exclude` (which corresponds to Vite's `optimizeDeps.exclude` and the newer `prebundle.exclude`):

```jsonc
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "projects": {
    "my-app": {
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            // … existing options …
            "optimizeDeps": {
              "exclude": ["@lite-translator/engine-onnx"],
            },
          },
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "options": {
            "buildTarget": "my-app:build",
            "optimizeDeps": {
              "exclude": ["@lite-translator/engine-onnx"],
            },
          },
        },
      },
    },
  },
}
```

> Note: Depending on the Angular/Vite version, the key is called `optimizeDeps.exclude` or `prebundle.exclude`; both are accepted by the dev server and have the same effect.

**Clear the cache:** After adding this, remove the Vite dependency cache once so the old (incorrect) prebundling of the worker is not reused:

```sh
# In the consumer project (not in the lite-translator repo)
rm -rf .angular/cache node_modules/.vite
# Windows PowerShell:
# Remove-Item -Recurse -Force .angular/cache, node_modules/.vite
```

Then restart `ng serve`. The worker is now served as an asset and is no longer prebundled; the model loads and translation works.

### Alternative syntax: `prebundle.exclude`

This section in `angular.json` configures the Angular dev server (internally Vite + esbuild) so that the package `@lite-translator/engine-onnx` is excluded from the dependency prebundling process. By default, Vite prebundles dependencies with esbuild to optimize them for browser delivery. However, aggressive optimization can modify packages that rely on specific runtime environments, dynamic imports, or web workers.

Excluding this library is a deliberate workaround. Since `@lite-translator/engine-onnx` bundles its own web worker code and WebAssembly (WASM) binaries internally, forcing Vite prebundling would change or break the internal module resolution the worker depends on. By adding it to the `exclude` array, you tell the dev server to ship the library unchanged; its internal structure remains intact and the worker script runs exactly as published:

```jsonc
"prebundle": {
  "exclude": ["@lite-translator/engine-onnx"]
}
```

> Note: `optimizeDeps.exclude` and `prebundle.exclude` are functionally equivalent; use the form expected by your Angular/Vite version.

## Step 5: Copy static assets explicitly (angular.json)

The modern, esbuild-based Angular builder does not automatically detect and emit web worker and WebAssembly files (WASM) nested deep inside third-party dependencies. At runtime, loading would fail. Therefore, you define them explicitly as assets via the `glob`, `input`, and `output` properties in the `"assets"` array of your build target:

```jsonc
"assets": [
  {
    "glob": "worker.js",
    "input": "node_modules/@lite-translator/engine-onnx/dist",
    "output": "."
  },
  {
    "glob": "ort-wasm-simd-threaded.asyncify.mjs",
    "input": "node_modules/onnxruntime-web/dist",
    "output": "."
  },
  {
    "glob": "ort-wasm-simd-threaded.asyncify.wasm",
    "input": "node_modules/onnxruntime-web/dist",
    "output": "."
  }
]
```

Each entry in the array describes a file to copy:

- **`glob`**: The filename pattern to match. Here we match the exact filenames of the worker script and the ONNX runtime binaries.
- **`input`**: The source directory relative to the workspace root, pointing to the library distribution folder inside `node_modules`.
- **`output`**: The target directory relative to the build output root. With `"."`, the files land at the root of your `dist` folder, which is typically needed so the web worker constructor and the ONNX runtime can resolve them correctly via relative URLs at runtime.

These three files are required for the library to work:

1. **`worker.js`**: The bundled web worker script that runs the translation model outside the main UI thread. If it is missing or placed incorrectly, the translation service cannot initialize the background process.
2. **`ort-wasm-simd-threaded.jsep.mjs`**: The ONNX Runtime web JavaScript module with the WebAssembly glue code. The ONNX runtime uses it as the interface between JavaScript and the compiled WASM binary.
3. **`ort-wasm-simd-threaded.jsep.wasm`**: The actual compiled WebAssembly binary containing the execution logic for machine learning. Without it, the translation model cannot run in the browser.

By copying these three files explicitly to the output root, the browser can fetch them successfully once the library initializes the worker and sets up the ONNX environment.

## Step 6: Batch translation

`translateBatch()` translates multiple texts in a single worker roundtrip. The
ONNX engine uses native Transformers.js batching (`pipe([...])`) — one
tokenization, encoder and decoder pass for the whole batch instead of N
sequential roundtrips. Result order matches input order; empty strings are
passed through unchanged. Batches larger than 32 texts are chunked automatically.

Extend the service with a batch helper:

```ts
// src/app/translation.service.ts (additions)
async translateBatch(texts: string[]): Promise<string[]> {
  const translator = await this.create();
  const results = await translator.translateBatch(texts);
  return results.map((r) => r.text);
}
```

Use it in a component — for example to translate a list of UI strings at once:

```ts
// src/app/translator-batch.component.ts
import { Component, inject, signal } from "@angular/core";
import { TranslationService } from "./translation.service";

interface StringItem {
  key: string;
  original: string;
}

@Component({
  selector: "app-translator-batch",
  standalone: true,
  template: `
    <button (click)="handleBatch()">Translate all</button>
    @for (item of items(); track item.key) {
      <div>{{ item.key }}: {{ item.original }} → {{ item.translated() }}</div>
    }
  `,
})
export class TranslatorBatchComponent {
  private readonly translation = inject(TranslationService);

  protected readonly items = signal<StringItem[]>([
    { key: "greeting", original: "Hallo Welt" },
    { key: "farewell", original: "Auf Wiedersehen" },
    { key: "question", original: "Wie geht es dir?" },
  ]);
  private readonly translations = signal<Record<string, string>>({});
  protected translated = (item: StringItem) => this.translations()[item.key] ?? "";

  protected async handleBatch(): Promise<void> {
    const originals = this.items().map((i) => i.original);
    const results = await this.translation.translateBatch(originals);
    const map: Record<string, string> = {};
    this.items().forEach((item, i) => {
      map[item.key] = results[i] ?? "";
    });
    this.translations.set(map);
  }
}
```

> **Performance:** For N short sentences, `translateBatch()` is typically 2–5×
> faster than N individual `translate()` calls because the fixed inference cost
> (session setup, KV-cache init, kernel dispatch) is paid once per batch.

## Notes

- **Lazy loading:** `createTranslator()` does not load a model yet. Only `translate()` or `preload()` loads the model from the Hugging Face Hub.
- **Signals:** The service uses `signal()` for progress so the template binding stays reactive. The component uses signals for `input`/`output`/`loading`.
- **Cleanup:** `ngOnDestroy` calls `dispose()` so the web worker is terminated when the component is destroyed; otherwise it keeps running. Alternatively, the service can remain `providedIn: "root"` and be disposed when the app ends if the translator is app-global.
- **Offline:** After the first download, translation works without network access. Use `await translator.isCached()` to check whether the model is already stored locally.
- **Web Worker + Angular build (Vite/esbuild):** The library ships the worker as a self-contained bundle (`dist/worker.js`), and `@huggingface/transformers` is already inlined — this is the **library requirement**. In addition, the consumer must add the package to `angular.json` under `optimizeDeps.exclude` so Vite does not prebundle the worker itself (see **Step 4**). Only both fixes together make the worker work in the dev server.
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts); for example, catch `OFFLINE_MODEL_MISSING` to show users a missing offline cache warning.
- **Testing:** Because the translator is encapsulated in the service, you can replace it in tests with a mock `Translator` (for example, via `TestBed.overrideProvider`).
