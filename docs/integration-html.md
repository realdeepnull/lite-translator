# Integration: HTML / Vanilla JavaScript

This guide shows how to use `@lite-translator/core` and `@lite-translator/engine-onnx` in a simple HTML page without a framework.

## Prerequisites

Follow [../README.md](../README.md) to build the packages. After that, the following files should exist:

- `packages/core/dist/index.js`
- `packages/engine-onnx/dist/index.js`
- `packages/engine-onnx/dist/worker.js`

The engine file `worker.js` is loaded automatically by `index.js` via the `new URL("./worker.js", import.meta.url)` pattern. The `@huggingface/transformers` package must also be available; the easiest way is an import map pointing to a CDN (esbuild/rolldown inlines it during bundling, but here we need to provide it manually).

## Option 1: npm pack + static server (recommended)

Create the tarballs:

```sh
npm pack --workspace @lite-translator/core
npm pack --workspace @lite-translator/engine-onnx
```

Create a project directory:

```sh
mkdir my-html-demo && cd my-html-demo
npm init -y
npm install ../lite-translator/lite-translator-core-0.2.0.tgz \
            ../lite-translator/lite-translator-engine-onnx-0.2.0.tgz
```

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>lite-translator demo</title>
  </head>
  <body>
    <textarea id="src" rows="4">Hallo Welt, how are you?</textarea>
    <button id="run">Translate</button>
    <output id="out" aria-live="polite"></output>
    <progress id="bar" max="1" value="0" style="width:100%"></progress>

    <script type="module">
      import { TranslatorPool, formatTranslatorError } from "@lite-translator/core";
      import { createOnnxEngine } from "@lite-translator/engine-onnx";

      const src = document.getElementById("src");
      const out = document.getElementById("out");
      const bar = document.getElementById("bar");

      // One shared engine (one Web Worker) + pool for all language pairs
      const pool = new TranslatorPool({
        engines: [createOnnxEngine()],
        onProgress: (e) => {
          if (Number.isFinite(e.progress)) bar.value = e.progress;
        },
        onDebug: (event) => {
          console.debug("[lite-translator]", event.type, event);
        },
      });

      document.getElementById("run").addEventListener("click", async () => {
        out.value = "Translating…";
        try {
          const translator = await pool.switchTo("de", "en");

          // Optional: inspect runtime capabilities after the model is loaded
          console.log(translator.capabilities());

          const result = await translator.translate(src.value);
          out.value = result.text;
          bar.value = 1;
        } catch (err) {
          out.value = formatTranslatorError(err);
        }
      });
    </script>
  </body>
</html>
```

> **AbortSignal:** `translate()` accepts an optional `AbortSignal` via
> `{ signal }`. When the signal is already aborted, the call rejects with
> `TRANSLATION_FAILED` ("Translation aborted"). Use this to cancel
> translations when the user switches language mid-flight.
>
> **0.2.0 update:** `onDebug` is available as an opt-in lifecycle callback on
> `TranslatorPool`/`Translator` creation and `capabilities()` exposes the
> resolved engine state (`device`, `dtype`, `modelId`, etc.) for runtime checks.

Start a static server (ES modules require HTTP, not `file://`):

```sh
npx serve .
```

Open the displayed URL in the browser. On the first translation, the library downloads the quantized OPUS-MT model from the Hugging Face Hub (about 30 MB); after that, it runs offline from the browser cache.

## Option 2: copy the dist bundles directly

Without npm — copy the built files into your project:

```text
my-html-demo/
├── core/
│   └── index.js          ← packages/core/dist/index.js
├── engine-onnx/
│   ├── index.js          ← packages/engine-onnx/dist/index.js
│   └── worker.js        ← packages/engine-onnx/dist/worker.js
└── index.html
```

Adjust the imports in the HTML:

```html
<script type="module">
  import { TranslatorPool } from "./core/index.js";
  import { createOnnxEngine } from "./engine-onnx/index.js";
  // …
</script>
```

⚠️ In this variant, the runtime dependency `@huggingface/transformers` must be resolved by the worker. Because the worker imports it, you either need an import map in the worker (not supported by all browsers) or you bundle it beforehand. **Option 1 is therefore much simpler.**

## Batch translation

`translateBatch()` translates multiple texts in a single worker roundtrip. The
ONNX engine uses native Transformers.js batching (`pipe([...])`) — one
tokenization, encoder and decoder pass for the whole batch instead of N
sequential roundtrips. Result order matches input order; empty strings are
passed through unchanged. Batches larger than 32 texts are chunked automatically.

```html
<script type="module">
  import { TranslatorPool, formatTranslatorError } from "@lite-translator/core";
  import { createOnnxEngine } from "@lite-translator/engine-onnx";

  const out = document.getElementById("out");

  const pool = new TranslatorPool({ engines: [createOnnxEngine()] });

  document.getElementById("runBatch").addEventListener("click", async () => {
    out.value = "Translating batch…";
    try {
      const translator = await pool.switchTo("de", "en");
      const inputs = ["Hallo Welt", "Guten Morgen", "Wie geht es dir?"];
      const results = await translator.translateBatch(inputs);
      out.value = results.map((r) => r.text).join("\n");
    } catch (err) {
      out.value = formatTranslatorError(err);
    }
  });
</script>
```

> **Performance:** For N short sentences, `translateBatch()` is typically 2–5×
> faster than N individual `translate()` calls because the fixed inference cost
> (session setup, KV-cache init, kernel dispatch) is paid once per batch.

## i18n-style translation: `t()` + `translateAll()`

For UI strings spread across the page, the `t()` / `translateAll()` pattern is
simpler than managing `translateBatch()` arrays yourself. Each "component" (a
DOM block in vanilla JS) registers its strings with a single `t(key, text)`
call; one `translateAll()` triggers a **single** `translateBatch()` for all
registered strings — one inference call, no race conditions.

The store lives inside core (`TranslationStore`). Vanilla JS binds to it via
`store.subscribe()` and updates the DOM when notified.

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <title>lite-translator — i18n demo</title>
  </head>
  <body>
    <!-- Component A: header -->
    <section id="header">
      <h1 data-key="header.title">Willkommen</h1>
      <p data-key="header.subtitle">Bitte wählen Sie eine Sprache</p>
    </section>

    <!-- Component B: footer -->
    <section id="footer">
      <button data-key="footer.button">Bestätigen</button>
      <a href="#" data-key="footer.link">Abbrechen</a>
    </section>

    <button id="translateAllBtn">Alle übersetzen</button>
    <output id="status"></output>

    <script type="module">
      import { TranslatorPool, formatTranslatorError } from "@lite-translator/core";
      import { createOnnxEngine } from "@lite-translator/engine-onnx";

      const status = document.getElementById("status");
      const translateAllBtn = document.getElementById("translateAllBtn");

      const pool = new TranslatorPool({ engines: [createOnnxEngine()] });
      const translator = await pool.switchTo("de", "en");

      const t = translator.t();

      // Register all strings from [data-key] elements and keep a reference.
      const elements = [...document.querySelectorAll("[data-key]")];
      for (const el of elements) {
        t(el.dataset.key, el.textContent);
      }

      // Subscribe to the store and update the DOM after translateAll().
      const store = translator.store();
      store.subscribe(() => {
        for (const el of elements) {
          el.textContent = t(el.dataset.key); // translated value or key fallback
        }
      });

      // One click, one inference call for all registered strings.
      translateAllBtn.addEventListener("click", async () => {
        translateAllBtn.disabled = true;
        status.value = "Übersetze…";
        try {
          await translator.translateAll();
          // → 1× translateBatch(["Willkommen", "Bitte wählen…", "Bestätigen", "Abbrechen"])
          // → store.subscribe fires → DOM updates automatically
          status.value = "Fertig — 1 Batch-Aufruf für alle Komponenten";
        } catch (err) {
          status.value = formatTranslatorError(err);
        } finally {
          translateAllBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>
```

> **Synchronous first render:** `t(key, text)` returns the original text
> immediately, so the page shows German on load. After `translateAll()`, the
> store notifies the subscriber and the DOM updates to English — no manual
> per-element wiring.
>
> **Deduplication:** If multiple elements register the same value (e.g.
> "Abbrechen" appears twice), core sends it to the engine only once.

## Live translation (while typing)

`translator.createLiveSession({ debounce })` translates **while the user
types** — ideal for chat messages or speech-to-text. The session segments the
input at sentence boundaries, caches translations of completed sentences, and
only re-translates the still-growing tail on each `update()`. Outdated results
are discarded automatically.

See [live-translation.md](live-translation.md) for the full concept. This is the
vanilla HTML binding.

```html
<textarea id="liveSrc" rows="4">Hallo Welt. Wie geht es dir?</textarea>
<output id="liveOut" aria-live="polite"></output>
<output id="livePartial" style="opacity: 0.6"></output>

<script type="module">
  import { TranslatorPool, formatTranslatorError } from "@lite-translator/core";
  import { createOnnxEngine } from "@lite-translator/engine-onnx";

  const src = document.getElementById("liveSrc");
  const out = document.getElementById("liveOut");
  const partial = document.getElementById("livePartial");

  const pool = new TranslatorPool({ engines: [createOnnxEngine()] });
  const translator = await pool.switchTo("de", "en");

  const live = translator.createLiveSession({ debounce: 250 });
  live.on("translation", (e) => {
    out.value = e.text;       // full translation (cached sentences + partial)
    partial.value = e.partial; // still-growing tail
  });
  live.on("error", (err) => {
    out.value = formatTranslatorError(err);
  });

  // Feed every keystroke; the session debounces internally.
  src.addEventListener("input", () => live.update(src.value));
</script>
```

- Completed sentences stay stable (cached); only the active fragment updates.
- Call `live.clear()` when a new message or speech turn begins.
- Call `live.dispose()` when the page is unloaded to cancel pending work.

## Multi-language (switching target languages)

Each `Translator` instance is bound to exactly one language pair (`from`/`to`).
To let the user switch languages at runtime, call `pool.switchTo(from, to)` —
it caches translators by pair and reuses the one already created. The pool
from the first example handles everything; no extra setup needed.

```html
<label>Source: <select id="srcLang">
  <option value="de">Deutsch</option>
  <option value="en">English</option>
  <option value="fr">Français</option>
</select></label>
<label>Target: <select id="tgtLang">
  <option value="en">English</option>
  <option value="de">Deutsch</option>
  <option value="fr">Français</option>
</select></label>
<textarea id="src" rows="4">Hallo Welt</textarea>
<button id="run">Translate</button>
<output id="out" aria-live="polite"></output>

<script type="module">
  import { TranslatorPool, formatTranslatorError } from "@lite-translator/core";
  import { createOnnxEngine } from "@lite-translator/engine-onnx";

  const srcLang = document.getElementById("srcLang");
  const tgtLang = document.getElementById("tgtLang");
  const src = document.getElementById("src");
  const out = document.getElementById("out");
  const run = document.getElementById("run");

  const pool = new TranslatorPool({ engines: [createOnnxEngine()] });

  run.addEventListener("click", async () => {
    out.value = "Translating…";
    try {
      const translator = await pool.switchTo(srcLang.value, tgtLang.value);
      const result = await translator.translate(src.value);
      out.value = result.text;
    } catch (err) {
      out.value = formatTranslatorError(err);
    }
  });
</script>
```

- Unsupported pairs throw `LANGUAGE_PAIR_NOT_SUPPORTED` immediately — show a
  friendly message. See [language-selection.md](language-selection.md) for the
  full list of built-in pairs and how to register custom ones.
- The engine is created once and shared across all translators via the pool;
  switching back to a previous pair reuses the cached model instantly.
- Dispose translators you no longer need with `await pool.disposePair(from, to)`
  (e.g. on page unload).

## Notes

- **Offline:** After the first model download, translation works without a network connection (Cache Storage).
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts) — for example `OFFLINE_MODEL_MISSING`, `LANGUAGE_PAIR_NOT_SUPPORTED`.
- **Dispose:** Call `await pool.dispose()` when the page is unloaded to terminate the web worker.