# Integration: Angular 22

This guide shows how to use `@lite-translator/core` and `@lite-translator/engine-onnx` in an Angular 22 app (Standalone Components, Signals).

## Installation

```sh
npm install @lite-translator/core @lite-translator/engine-onnx
```

## Architecture decision: service instead of direct import

Angular applications should resolve dependencies via DI (Dependency Injection). We encapsulate translator creation in an injectable service. This makes the components testable and engine-independent.

## Step 1: TranslationService

The service holds a shared engine and a `TranslatorPool`. The pool caches translators by language pair — `switchTo(from, to)` returns a cached translator instantly when available. Components call `pool.switchTo()` directly and work with the returned `Translator`.

```ts
// src/app/translation.service.ts
import { Injectable, signal } from "@angular/core";
import { TranslatorPool, type ProgressEvent } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

@Injectable({ providedIn: "root" })
export class TranslationService {
  // Engine einmal erstellen — ein Worker für alle Translatoren.
  private readonly engine = createOnnxEngine();

  readonly pool = new TranslatorPool({
    engines: [this.engine],
    onProgress: (e: ProgressEvent) => {
      if (Number.isFinite(e.progress)) {
        this.progress.set(e.progress);
        this.statusText.set(`Lade Modell … ${Math.round(e.progress * 100)}%`);
      }
    },
  });

  /** Progress signal for the UI (0..1) */
  readonly progress = signal(0);
  readonly statusText = signal("Bereit");
}
```

> **Rule of thumb:** call `createOnnxEngine()` **exactly once** per app lifetime.
> Pass the instance to `TranslatorPool` (or `createTranslator()`). Creating
> the engine inside a `switchTo()` call spawns a new Web Worker per language
> pair (~30–50 MB each). The service above does it correctly.

## Step 2: Standalone component — translate

```ts
// src/app/translator-demo.component.ts
import { Component, inject, signal } from "@angular/core";
import { formatTranslatorError, type Translator } from "@lite-translator/core";
import { TranslationService } from "./translation.service";

@Component({
  selector: "app-translator-demo",
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
export class TranslatorDemoComponent {
  protected readonly translation = inject(TranslationService);

  protected readonly input = signal("Hallo Welt, wie geht es dir?");
  protected readonly output = signal("");
  protected readonly loading = signal(false);

  private translator: Translator | null = null;

  private async getTranslator(): Promise<Translator> {
    if (!this.translator) {
      this.translator = await this.translation.pool.switchTo("de", "en");
    }
    return this.translator;
  }

  protected async handleTranslate(): Promise<void> {
    this.loading.set(true);
    this.output.set("");
    try {
      const t = await this.getTranslator();
      const result = await t.translate(this.input());
      this.output.set(result.text);
    } catch (err) {
      this.output.set(formatTranslatorError(err));
    } finally {
      this.loading.set(false);
    }
  }
}
```

> **AbortSignal:** `translate()` accepts an optional `AbortSignal` via
> `{ signal }`. When the signal is already aborted, the call rejects with
> `TRANSLATION_FAILED` ("Translation aborted"). Use this to cancel
> translations when the user switches language mid-flight.

## Step 3: Register in the router

```ts
// src/app/app.routes.ts
import { Routes } from "@angular/router";
import { TranslatorDemoComponent } from "./translator-demo.component";

export const routes: Routes = [
  { path: "", component: TranslatorDemoComponent, pathMatch: "full" },
];
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

No service changes needed — call `translateBatch()` on the translator directly:

```ts
// src/app/translator-batch.component.ts
import { Component, inject, signal } from "@angular/core";
import { formatTranslatorError, type Translator } from "@lite-translator/core";
import { TranslationService } from "./translation.service";

interface BatchItem {
  title: string;
  text: string;
  translated: string;
  status: "pending" | "busy" | "done" | "error";
}

@Component({
  selector: "app-translator-batch",
  standalone: true,
  template: `
    <button [disabled]="running()" (click)="handleBatch()">Translate all</button>
    @for (item of items(); track item.title) {
      <div>
        <h3>{{ item.title }}</h3>
        <p>{{ item.text }}</p>
        <p>{{ item.translated }}</p>
      </div>
    }
  `,
})
export class TranslatorBatchComponent {
  protected readonly translation = inject(TranslationService);

  protected readonly running = signal(false);
  protected readonly items = signal<BatchItem[]>([
    { title: "Reisebericht", text: "Letzten Sommer bin ich …", translated: "", status: "pending" },
    { title: "Kurzgeschichte", text: "Die alte Bibliothek …", translated: "", status: "pending" },
  ]);

  private translator: Translator | null = null;

  private async getTranslator(): Promise<Translator> {
    if (!this.translator) {
      this.translator = await this.translation.pool.switchTo("de", "en");
    }
    return this.translator;
  }

  protected async handleBatch(): Promise<void> {
    this.running.set(true);
    this.items.update((list) =>
      list.map((item) => ({ ...item, translated: "", status: "busy" as const })),
    );
    try {
      const t = await this.getTranslator();
      const texts = this.items().map((i) => i.text);
      const results = await t.translateBatch(texts);
      this.items.update((list) =>
        list.map((item, i) => ({
          ...item,
          translated: results[i]?.text ?? "",
          status: "done" as const,
        })),
      );
    } catch (err) {
      this.items.update((list) =>
        list.map((item) => ({
          ...item,
          translated: formatTranslatorError(err),
          status: "error" as const,
        })),
      );
    } finally {
      this.running.set(false);
    }
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
signal that mirrors `store.snapshot()`.

### Component — register strings, read reactively, translate all

```ts
// src/app/i18n-page.component.ts
import { Component, inject, signal } from "@angular/core";
import { formatTranslatorError, type Translator } from "@lite-translator/core";
import { TranslationService } from "./translation.service";

interface UiString {
  key: string;
  original: string;
  section: "header" | "footer" | "toolbar";
}

const UI_STRINGS: UiString[] = [
  { key: "header.title", original: "Willkommen", section: "header" },
  { key: "header.subtitle", original: "Bitte wählen Sie eine Sprache", section: "header" },
  { key: "footer.button", original: "Bestätigen", section: "footer" },
  { key: "footer.link", original: "Abbrechen", section: "footer" },
  { key: "toolbar.translateAll", original: "Alle übersetzen", section: "toolbar" },
  { key: "toolbar.translating", original: "Übersetze …", section: "toolbar" },
];

@Component({
  selector: "app-i18n-page",
  standalone: true,
  template: `
    <button [disabled]="loading()" (click)="handleTranslateAll()">
      {{ loading() ? value("toolbar.translating") : value("toolbar.translateAll") }}
    </button>
    <table>
      @for (item of uiStrings; track item.key) {
        <tr>
          <td><code>{{ item.key }}</code></td>
          <td>{{ item.original }}</td>
          <td>{{ value(item.key) || '—' }}</td>
        </tr>
      }
    </table>
  `,
})
export class I18nPageComponent {
  protected readonly translation = inject(TranslationService);

  protected readonly loading = signal(false);
  protected readonly ready = signal(false);
  protected readonly translations = signal<Record<string, string>>({});

  protected readonly uiStrings = UI_STRINGS;

  private translator: Translator | null = null;
  private tFn: ((key: string, text?: string) => string) | null = null;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.translator = await this.translation.pool.switchTo("de", "en");
    this.tFn = this.translator.t();

    // Subscribe to store updates → signal updates → template re-renders
    const store = this.translator.store()!;
    store.subscribe(() => this.translations.set(store.snapshot()));

    // Register all UI strings (synchronous, returns original text immediately)
    for (const item of UI_STRINGS) {
      this.tFn!(item.key, item.original);
    }
    this.ready.set(true);
  }

  protected async handleTranslateAll(): Promise<void> {
    this.loading.set(true);
    try {
      await this.translator!.translateAll();
    } catch (err) {
      console.error(formatTranslatorError(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected value(key: string): string {
    return this.translations()[key] ?? "";
  }
}
```

> **Synchronous first render:** `t(key, text)` returns the original text
> immediately, so the first paint shows German. After `translateAll()`, the
> `translations()` signal updates and the templates re-render in English.
>
> **Deduplication:** If multiple components register the same value (e.g.
> "Abbrechen" appears twice), core sends it to the engine only once.
>
> **Cross-component:** To share `t()` and `translations()` across multiple
> components, expose them as signals on `TranslationService` instead of in a
> single component (same pattern, just hoisted into the service).

## Live translation (while typing)

`translator.createLiveSession({ debounce })` translates **while the user
types** — ideal for chat messages or speech-to-text. The session segments the
input at sentence boundaries, caches translations of completed sentences, and
only re-translates the still-growing tail on each `update()`. Outdated results
are discarded automatically.

See [live-translation.md](live-translation.md) for the full concept. This is the
Angular 22 (Signals) binding.

### Component — wire the session to signals

```ts
// src/app/live-translation-page.component.ts
import { Component, inject, signal } from "@angular/core";
import {
  formatTranslatorError,
  type LiveSession,
  type LiveTranslationEvent,
  type Translator,
} from "@lite-translator/core";
import { TranslationService } from "./translation.service";

@Component({
  selector: "app-live-translation-page",
  standalone: true,
  template: `
    <div style="max-width: 480px; display: grid; gap: 12px">
      <textarea
        [value]="input()"
        (input)="onInput($any($event.target).value)"
        rows="4"
      ></textarea>
      <output style="white-space: pre-wrap">{{ text() }}</output>
      <output style="opacity: 0.6">{{ partial() }}</output>
    </div>
  `,
})
export class LiveTranslationPageComponent {
  protected readonly translation = inject(TranslationService);

  protected readonly input = signal("Hallo Welt. Wie geht es dir?");
  protected readonly text = signal("");
  protected readonly partial = signal("");
  protected readonly loading = signal(true);
  protected readonly error = signal("");

  private session: LiveSession | null = null;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const translator: Translator =
        await this.translation.pool.switchTo("de", "en");
      this.session = translator.createLiveSession({ debounce: 250 });
      this.session.on("translation", (e: LiveTranslationEvent) => {
        this.text.set(e.text);
        this.partial.set(e.partial);
      });
      this.session.on("error", (err) => {
        this.error.set(formatTranslatorError(err));
      });
      this.loading.set(false);
      this.session.update(this.input());
    } catch (err) {
      this.loading.set(false);
      this.error.set(formatTranslatorError(err));
    }
  }

  protected onInput(value: string): void {
    this.input.set(value);
    this.session?.update(value);
  }

  protected handleClear(): void {
    this.input.set("");
    this.text.set("");
    this.partial.set("");
    this.session?.clear();
  }
}
```

- Completed sentences stay stable (cached); only the active fragment updates.
- `clear()` resets the session — canceling pending debounced work. The
  translator itself is app-global (`providedIn: "root"`) and stays alive.
- For speech-to-text, feed `live.update(text)` from the recognizer's `onresult`
  handler and render `e.segments` filtered by `complete` for the stable area.

## Multi-language (switching target languages)

Each `Translator` instance is bound to exactly one language pair (`from`/`to`).
To let the user switch languages at runtime, call `pool.switchTo(from, to)` —
it caches translators by pair and reuses the one already created. An optional
`maxSize` enables LRU eviction of the oldest cached translator. No service
changes needed — the pool is already on `TranslationService` from Step 1.

### Component — let the user pick a pair

```ts
// src/app/multi-language-page.component.ts
import { Component, inject, signal } from "@angular/core";
import { formatTranslatorError, type Translator } from "@lite-translator/core";
import { TranslationService } from "./translation.service";

const LANGS = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
];

@Component({
  selector: "app-multi-language-page",
  standalone: true,
  template: `
    <div style="display: flex; gap: 12px">
      <label>
        From:
        <select [value]="from()" (change)="handleFromChange($event)">
          @for (lang of langs; track lang.code) {
            <option [value]="lang.code">{{ lang.label }}</option>
          }
        </select>
      </label>
      <label>
        To:
        <select [value]="to()" (change)="handleToChange($event)">
          @for (lang of langs; track lang.code) {
            <option [value]="lang.code">{{ lang.label }}</option>
          }
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
  `,
})
export class MultiLanguagePageComponent {
  protected readonly translation = inject(TranslationService);

  protected readonly langs = LANGS;
  protected readonly from = signal("de");
  protected readonly to = signal("en");
  protected readonly input = signal("Hallo Welt");
  protected readonly output = signal("");
  protected readonly loading = signal(false);
  protected readonly currentPair = signal("de-en");

  private translator: Translator | null = null;

  private async switchTo(newFrom: string, newTo: string): Promise<Translator> {
    const translator = await this.translation.pool.switchTo(newFrom, newTo);
    this.currentPair.set(`${newFrom}-${newTo}`);
    return translator;
  }

  protected async handleTranslate(): Promise<void> {
    this.loading.set(true);
    this.output.set("");
    try {
      this.translator = await this.switchTo(this.from(), this.to());
      const result = await this.translator.translate(this.input());
      this.output.set(result.text);
    } catch (err) {
      this.output.set(formatTranslatorError(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected handleFromChange(event: Event): void {
    this.from.set((event.target as HTMLSelectElement).value);
    if (this.from() === this.to()) {
      this.to.set(LANGS.find((l) => l.code !== this.from())!.code);
    }
    this.translator = null;
  }

  protected handleToChange(event: Event): void {
    this.to.set((event.target as HTMLSelectElement).value);
    if (this.from() === this.to()) {
      this.from.set(LANGS.find((l) => l.code !== this.to())!.code);
    }
    this.translator = null;
  }
}
```

- Unsupported pairs throw `LANGUAGE_PAIR_NOT_SUPPORTED` immediately — show a
  friendly message. See [language-selection.md](language-selection.md) for the
  full list of built-in pairs and how to register custom ones.
- The engine is created once and shared across all translators via
  `TranslatorPool`; switching back to a previous pair reuses the cached model
  instantly.
- Dispose translators you no longer need via
  `this.translation.pool.disposePair(from, to)` (e.g. on app logout).

## Notes

- **Lazy loading:** `createTranslator()` and `pool.switchTo()` do not load a
  model yet. Only `translate()` or `preload()` loads the model from the
  Hugging Face Hub.
- **Signals:** The service uses `signal()` for progress; components use signals
  for `input`/`output`/`loading`.
- **Offline:** After the first download, translation works without network
  access. Use `await translator.isCached()` to check whether the model is
  already stored locally.
- **Web Worker + Angular build (Vite/esbuild):** The library ships the worker
  as a self-contained bundle (`dist/worker.js`), and `@huggingface/transformers`
  is already inlined — this is the **library requirement**. In addition, the
  consumer must add the package to `angular.json` under `optimizeDeps.exclude`
  so Vite does not prebundle the worker itself (see **Step 4** and **Step 5**). Only both
  fixes together make the worker work in the dev server.
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts);
  use `formatTranslatorError()` for consistent error strings.
- **Testing:** Because the translator is encapsulated in the service, you can
  replace the pool in tests with a mock (for example, via
  `TestBed.overrideProvider`).
