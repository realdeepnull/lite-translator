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
import { Injectable, signal } from "@angular/core";
import {
  createTranslator,
  formatTranslatorError,
  type ProgressEvent,
  type Translator,
} from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

@Injectable({ providedIn: "root" })
export class TranslationService {
  // Engine einmal erstellen und als Klassenfeld halten — ein Worker für
  // alle Translatoren, nicht einer pro Sprachpaar (F3: Engine-Sharing).
  // Siehe Abschnitt "Engine-Sharing Best Practice" unten.
  private readonly engine = createOnnxEngine();

  private translator: Translator | null = null;

  /** Progress signal for the UI (0..1) */
  readonly progress = signal(0);

  async create(): Promise<Translator> {
    if (this.translator) return this.translator;
    this.translator = await createTranslator({
      from: "de",
      to: "en",
      engines: [this.engine],
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

## Engine-Sharing Best Practice (F3)

Each `createOnnxEngine()` call starts a new Web Worker (`new Worker(...)`) on
the first `load()`. Creating the engine **inside** `create()` (or worse, inside
`switchTo()`) means every language pair spawns its own worker — costing
~30–50 MB of memory per extra pair (ONNX runtime + model). This is the **F3
Engine-Sharing** pitfall identified during the framework analysis.

The fix is purely a consumer-side best practice — the library already
supports shared engines, it just needs to be used correctly. There are two
equivalent approaches:

### Option A: Shared engine field (recommended, used above)

Create the engine once as a class field and pass it to every
`createTranslator()` call:

```ts
private readonly engine = createOnnxEngine();

async create(): Promise<Translator> {
  this.translator = await createTranslator({
    from: "de",
    to: "en",
    engines: [this.engine],  // ← shared, not a new worker
  });
  return this.translator;
}
```

This is the approach used in Step 1 and in the multi-language `TranslatorPool`
section below.

### Option B: Global default engine

Register the engine globally once at app startup. `createTranslator()` calls
without an `engines` option automatically use the registered default:

```ts
// main.ts or app.config.ts
import { registerDefaultEngine } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

registerDefaultEngine(createOnnxEngine());

// Anywhere — no `engines` needed:
const t = await createTranslator({ from: "de", to: "en" });
```

> **Rule of thumb:** call `createOnnxEngine()` **exactly once** per app
> lifetime. Pass the resulting instance to every `createTranslator()` (or to
> `TranslatorPool`) — or register it globally with `registerDefaultEngine()`.

| Pattern                                               | Workers          | Memory | Correct? |
| ----------------------------------------------------- | ---------------- | ------ | -------- |
| `engines: [createOnnxEngine()]` per `switchTo()` call | N (one per pair) | high   | ❌       |
| Shared engine field (Option A)                        | 1                | low    | ✅       |
| `registerDefaultEngine()` (Option B)                  | 1                | low    | ✅       |

## Step 2: Standalone component

```ts
// src/app/translator-example.component.ts
import { Component, OnDestroy, inject, signal } from "@angular/core";
import { formatTranslatorError } from "@lite-translator/core";
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
      this.output.set(formatTranslatorError(err));
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

> **AbortSignal:** `translate()` accepts an optional `AbortSignal` via
> `{ signal }`. When the signal is already aborted, the call rejects with
> `TRANSLATION_FAILED` ("Translation aborted"). Use this to cancel
> translations when the user switches language mid-flight.

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
    "glob": "worker.js.map",
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

## i18n-style translation: `t()` + `translateAll()`

For UI strings spread across many components, the `t()` / `translateAll()`
pattern is simpler than managing `translateBatch()` arrays yourself. Each
component registers its strings with a single `t(key, text)` call; one
`translateAll()` triggers a **single** `translateBatch()` for all registered
strings — one inference call, no race conditions, no per-component arrays.

The store lives inside core (`TranslationStore`). Angular binds to it via a
signal that mirrors `store.snapshot()`. Components see only `t()` for
registration and reading; the service wires the reactivity.

### Step 1: Service — expose `t()` and `translateAll()` as signals

```ts
// src/app/translation.service.ts (additions)
import { signal } from "@angular/core";
import { type Translator } from "@lite-translator/core";

@Injectable({ providedIn: "root" })
export class TranslationService {
  private translator: Translator | null = null;
  private tFn: ((key: string, text?: string) => string) | null = null;

  /** Signal that mirrors the store snapshot; updates after translateAll(). */
  readonly translations = signal<Record<string, string>>({});

  /**
   * Returns the bound t(key, text?) function. The first call creates the
   * internal store; the subscribe callback keeps `translations()` in sync.
   * Since `snapshot()` returns a cached frozen reference (F1), no
   * `untracked()` wrapper is needed.
   */
  t(): (key: string, text?: string) => string {
    if (!this.tFn) {
      this.tFn = this.translator!.t();
      const store = this.translator!.store()!;
      store.subscribe(() => {
        this.translations.set(store.snapshot());
      });
    }
    return this.tFn;
  }

  /** One inference call for all registered strings. */
  async translateAll(): Promise<void> {
    const translator = await this.create();
    await translator.translateAll();
  }
}
```

### Step 2: Components — register strings, read reactively

```ts
// src/app/header.component.ts
import { Component, inject } from "@angular/core";
import { TranslationService } from "./translation.service";

@Component({
  selector: "app-header",
  standalone: true,
  template: `
    <h1>{{ translations()["header.title"] }}</h1>
    <p>{{ translations()["header.subtitle"] }}</p>
  `,
})
export class HeaderComponent {
  private readonly translation = inject(TranslationService);
  readonly translations = this.translation.translations;

  constructor() {
    const t = this.translation.t();
    t("header.title", "Willkommen");
    t("header.subtitle", "Bitte wählen Sie eine Sprache");
  }
}
```

```ts
// src/app/footer.component.ts
import { Component, inject } from "@angular/core";
import { TranslationService } from "./translation.service";

@Component({
  selector: "app-footer",
  standalone: true,
  template: `
    <button>{{ translations()["footer.button"] }}</button>
    <a href="#">{{ translations()["footer.link"] }}</a>
  `,
})
export class FooterComponent {
  private readonly translation = inject(TranslationService);
  readonly translations = this.translation.translations;

  constructor() {
    const t = this.translation.t();
    t("footer.button", "Bestätigen");
    t("footer.link", "Abbrechen");
  }
}
```

### Step 3: Toolbar — one click, all components translated

```ts
// src/app/toolbar.component.ts
import { Component, inject, signal } from "@angular/core";
import { TranslationService } from "./translation.service";

@Component({
  selector: "app-toolbar",
  standalone: true,
  template: `
    <button [disabled]="loading()" (click)="onTranslateAll()">
      {{ loading() ? "Übersetze…" : "Alle übersetzen" }}
    </button>
  `,
})
export class ToolbarComponent {
  private readonly translation = inject(TranslationService);
  readonly loading = signal(false);

  async onTranslateAll(): Promise<void> {
    this.loading.set(true);
    try {
      await this.translation.translateAll();
      // → 1× translateBatch(["Willkommen", "Bitte wählen…", "Bestätigen", "Abbrechen"])
      // → signals in HeaderComponent and FooterComponent update automatically
    } finally {
      this.loading.set(false);
    }
  }
}
```

> **Synchronous first render:** `t(key, text)` returns the original text
> immediately, so the first paint shows German. After `translateAll()`, the
> `translations()` signal updates and the templates re-render in English — no
> manual wiring per component.
>
> **Deduplication:** If multiple components register the same value (e.g.
> "Abbrechen" appears twice), core sends it to the engine only once.

## Live translation (while typing)

`translator.createLiveSession({ debounce })` translates **while the user
types** — ideal for chat messages or speech-to-text. The session segments the
input at sentence boundaries, caches translations of completed sentences, and
only re-translates the still-growing tail on each `update()`. Outdated results
are discarded automatically.

See [live-translation.md](live-translation.md) for the full concept. This is the
Angular 22 (Signals) binding.

### Step 1: Service — expose a live session factory

Add a thin factory to `TranslationService`. It uses the currently selected
translator (set via `create()` in Step 1 or `switchTo()` in the multi-language
section below):

```ts
// src/app/translation.service.ts (additions)
import { type LiveSession } from "@lite-translator/core";

createLiveSession(options?: { debounce?: number }): LiveSession {
  return this.translator!.createLiveSession(options);
}
```

### Step 2: Component — wire the session to a signal

```ts
// src/app/live-translator.component.ts
import { Component, OnDestroy, inject, signal } from "@angular/core";
import { TranslationService } from "./translation.service";
import type { LiveSession, LiveTranslationEvent } from "@lite-translator/core";

@Component({
  selector: "app-live-translator",
  standalone: true,
  template: `
    <div style="max-width: 480px; display: grid; gap: 12px">
      <textarea [value]="input()" (input)="onInput($any($event.target).value)" rows="4"></textarea>
      <output style="white-space: pre-wrap">{{ text() }}</output>
      <output style="opacity: 0.6">{{ partial() }}</output>
    </div>
  `,
})
export class LiveTranslatorComponent implements OnDestroy {
  private readonly translation = inject(TranslationService);
  private session: LiveSession | null = null;

  protected readonly input = signal("Hallo Welt. Wie geht es dir?");
  protected readonly text = signal("");
  protected readonly partial = signal("");

  constructor() {
    void this.translation.create().then((translator) => {
      this.session = translator.createLiveSession({ debounce: 250 });
      this.session.on("translation", (e: LiveTranslationEvent) => {
        this.text.set(e.text);
        this.partial.set(e.partial);
      });
    });
  }

  protected onInput(value: string): void {
    this.input.set(value);
    this.session?.update(value);
  }

  ngOnDestroy(): void {
    // Cancels pending debounced work; the translator itself stays alive.
    this.session?.dispose();
    this.session = null;
  }
}
```

- Completed sentences stay stable (cached); only the active fragment updates.
- `ngOnDestroy` disposes the session — canceling pending debounced work. The
  translator itself is app-global (`providedIn: "root"`) and stays alive.
- For speech-to-text, feed `live.update(text)` from the recognizer's `onresult`
  handler and render `e.segments` filtered by `complete` for the stable area.

## Multi-language (switching target languages)

Each `Translator` instance is bound to exactly one language pair (`from`/`to`).
To let the user switch languages at runtime, the service uses `TranslatorPool`
which caches translators by pair and reuses the one already created. An
optional `maxSize` enables LRU eviction of the oldest cached translator.

### Step 1: Service — use TranslatorPool

Extend `TranslationService` (from Step 1) with a `TranslatorPool`. The full file
becomes:

```ts
// src/app/translation.service.ts
import { Injectable, signal } from "@angular/core";
import {
  TranslatorPool,
  formatTranslatorError,
  type ProgressEvent,
  type Translator,
} from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

@Injectable({ providedIn: "root" })
export class TranslationService {
  private readonly engine = createOnnxEngine();
  private readonly pool = new TranslatorPool({
    engines: [this.engine],
    maxSize: 3, // dispose oldest translator beyond this limit
  });

  /** Current target pair as a reactive signal (e.g. "de-en"). */
  readonly pair = signal<string | null>(null);

  /** Progress signal for the UI (0..1) */
  readonly progress = signal(0);

  /**
   * Switches (or creates) the translator for the given pair. Reuses a cached
   * instance so the model stays loaded and the switch is instant.
   */
  async switchTo(from: string, to: string): Promise<Translator> {
    const translator = await this.pool.switchTo(from, to);
    this.pair.set(`${from}-${to}`);
    return translator;
  }

  async isCached(): Promise<boolean> {
    const current = this.pool.current();
    return current ? current.isCached() : false;
  }

  /** Disposes a single cached translator (e.g. to free memory). */
  async disposePair(from: string, to: string): Promise<void> {
    await this.pool.disposePair(from, to);
  }

  async dispose(): Promise<void> {
    await this.pool.dispose();
    this.pair.set(null);
  }
}
```

### Step 2: Component — let the user pick a pair

```ts
// src/app/multi-language-translator.component.ts
import { Component, inject, signal } from "@angular/core";
import { formatTranslatorError } from "@lite-translator/core";
import { TranslationService } from "./translation.service";

@Component({
  selector: "app-multi-language-translator",
  standalone: true,
  template: `
    <div style="max-width: 480px; display: grid; gap: 12px">
      <div style="display: flex; gap: 12px">
        <label>
          From:
          <select [value]="from()" (change)="from.set($any($event.target).value)">
            <option value="de">Deutsch</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </label>
        <label>
          To:
          <select [value]="to()" (change)="to.set($any($event.target).value)">
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="fr">Français</option>
          </select>
        </label>
      </div>
      <textarea
        [value]="input()"
        (input)="input.set($any($event.target).value)"
        rows="4"
      ></textarea>
      <button [disabled]="loading()" (click)="handleTranslate()">
        {{ loading() ? "Translating…" : "Translate" }}
      </button>
      <output style="white-space: pre-wrap">{{ output() }}</output>
    </div>
  `,
})
export class MultiLanguageTranslatorComponent {
  private readonly translation = inject(TranslationService);

  protected readonly from = signal("de");
  protected readonly to = signal("en");
  protected readonly input = signal("Hallo Welt");
  protected readonly output = signal("");
  protected readonly loading = signal(false);

  protected async handleTranslate(): Promise<void> {
    this.loading.set(true);
    this.output.set("");
    try {
      const translator = await this.translation.switchTo(this.from(), this.to());
      const result = await translator.translate(this.input());
      this.output.set(result.text);
    } catch (err) {
      this.output.set(formatTranslatorError(err));
    } finally {
      this.loading.set(false);
    }
  }
}
```

- Unsupported pairs throw `LANGUAGE_PAIR_NOT_SUPPORTED` immediately — show a
  friendly message. See [language-selection.md](language-selection.md) for the
  full list of built-in pairs and how to register custom ones.
- The engine is created once and shared across all translators via
  `TranslatorPool`; switching back to a previous pair reuses the cached model
  instantly.
- Dispose translators you no longer need via `translation.disposePair(from, to)`
  (e.g. on app logout). The engine worker terminates when the last translator
  is disposed — or keep the engine alive for the whole app lifetime.

## Notes

- **Lazy loading:** `createTranslator()` does not load a model yet. Only `translate()` or `preload()` loads the model from the Hugging Face Hub.
- **Signals:** The service uses `signal()` for progress so the template binding stays reactive. The component uses signals for `input`/`output`/`loading`.
- **Cleanup:** `ngOnDestroy` calls `dispose()` so the web worker is terminated when the component is destroyed; otherwise it keeps running. Alternatively, the service can remain `providedIn: "root"` and be disposed when the app ends if the translator is app-global.
- **Offline:** After the first download, translation works without network access. Use `await translator.isCached()` to check whether the model is already stored locally.
- **Web Worker + Angular build (Vite/esbuild):** The library ships the worker as a self-contained bundle (`dist/worker.js`), and `@huggingface/transformers` is already inlined — this is the **library requirement**. In addition, the consumer must add the package to `angular.json` under `optimizeDeps.exclude` so Vite does not prebundle the worker itself (see **Step 4**). Only both fixes together make the worker work in the dev server.
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts); use `formatTranslatorError()` for consistent error strings. For example, catch `OFFLINE_MODEL_MISSING` to show users a missing offline cache warning.
- **Testing:** Because the translator is encapsulated in the service, you can replace it in tests with a mock `Translator` (for example, via `TestBed.overrideProvider`).
