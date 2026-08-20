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
npm install ../lite-translator/lite-translator-core-0.0.1.tgz \
            ../lite-translator/lite-translator-engine-onnx-0.0.1.tgz
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
      import { createTranslator } from "@lite-translator/core";
      import { createOnnxEngine } from "@lite-translator/engine-onnx";

      const src = document.getElementById("src");
      const out = document.getElementById("out");
      const bar = document.getElementById("bar");

      document.getElementById("run").addEventListener("click", async () => {
        out.value = "Loading model…";
        try {
          const translator = await createTranslator({
            from: "de",
            to: "en",
            engines: [createOnnxEngine()],
            onProgress: (e) => {
              if (Number.isFinite(e.progress)) bar.value = e.progress;
            },
          });
          out.value = "Translating…";
          const result = await translator.translate(src.value);
          out.value = result.text;
          bar.value = 1;
        } catch (err) {
          out.value = `Error: ${err?.code ?? "UNKNOWN"}: ${err?.message ?? err}`;
        }
      });
    </script>
  </body>
</html>
```

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
  import { createTranslator } from "./core/index.js";
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
  import { createTranslator } from "@lite-translator/core";
  import { createOnnxEngine } from "@lite-translator/engine-onnx";

  const out = document.getElementById("out");

  document.getElementById("runBatch").addEventListener("click", async () => {
    out.value = "Translating batch…";
    try {
      const translator = await createTranslator({
        from: "de",
        to: "en",
        engines: [createOnnxEngine()],
      });
      const inputs = ["Hallo Welt", "Guten Morgen", "Wie geht es dir?"];
      const results = await translator.translateBatch(inputs);
      out.value = results.map((r) => r.text).join("\n");
      await translator.dispose();
    } catch (err) {
      out.value = `Error: ${err?.code ?? "UNKNOWN"}: ${err?.message ?? err}`;
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
      import { createTranslator } from "@lite-translator/core";
      import { createOnnxEngine } from "@lite-translator/engine-onnx";

      const status = document.getElementById("status");
      const translateAllBtn = document.getElementById("translateAllBtn");

      const translator = await createTranslator({
        from: "de",
        to: "en",
        engines: [createOnnxEngine()],
      });

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
          status.value = `Error: ${err?.code ?? "UNKNOWN"}: ${err?.message ?? err}`;
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

## Notes

- **Offline:** After the first model download, translation works without a network connection (Cache Storage).
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts) — for example `OFFLINE_MODEL_MISSING`, `LANGUAGE_PAIR_NOT_SUPPORTED`.
- **Dispose:** Call `await translator.dispose()` when you no longer need the translator to terminate the web worker.