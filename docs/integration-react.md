# Integration: React 18

This guide shows how to use `@lite-translator/core` and `@lite-translator/engine-onnx` in a React 18 app.

## Installation

```sh
npm install @lite-translator/core @lite-translator/engine-onnx
```

## Example: Translator component

```tsx
import { useEffect, useRef, useState } from "react";
import {
  createTranslator,
  formatTranslatorError,
  type Translator,
  type ProgressEvent,
} from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

export function TranslatorExample() {
  const [input, setInput] = useState("Hallo Welt, wie geht es dir?");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const translatorRef = useRef<Translator | null>(null);

  // Create the translator on mount and clean up on unmount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const translator = await createTranslator({
        from: "de",
        to: "en",
        engines: [createOnnxEngine()],
        onProgress: (e: ProgressEvent) => {
          if (Number.isFinite(e.progress)) setProgress(e.progress);
        },
      });
      if (cancelled) {
        await translator.dispose();
        return;
      }
      translatorRef.current = translator;
    })();
    return () => {
      cancelled = true;
      void translatorRef.current?.dispose();
      translatorRef.current = null;
    };
  }, []);

  const handleTranslate = async () => {
    const translator = translatorRef.current;
    if (!translator) return;
    setLoading(true);
    setOutput("");
    try {
      const result = await translator.translate(input);
      setOutput(result.text);
    } catch (err) {
      setOutput(formatTranslatorError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 480, display: "grid", gap: 12 }}>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={4} />
      <button onClick={handleTranslate} disabled={loading}>
        {loading ? "Translating…" : "Translate"}
      </button>
      {loading && <progress max={1} value={progress} style={{ width: "100%" }} />}
      <output style={{ whiteSpace: "pre-wrap" }}>{output}</output>
    </div>
  );
}
```

> **AbortSignal:** `translate()` accepts an optional `AbortSignal` via
> `{ signal }`. When the signal is already aborted, the call rejects with
> `TRANSLATION_FAILED` ("Translation aborted"). Use this to cancel
> translations when the user switches language mid-flight.

## Batch translation

`translateBatch()` translates multiple texts in a single worker roundtrip. The
ONNX engine uses native Transformers.js batching (`pipe([...])`) — one
tokenization, encoder and decoder pass for the whole batch instead of N
sequential roundtrips. Result order matches input order; empty strings are
passed through unchanged. Batches larger than 32 texts are chunked automatically.

```tsx
function BatchTranslator() {
  const [outputs, setOutputs] = useState<string[]>([]);
  const translatorRef = useRef<Translator | null>(null);

  // … create translator in useEffect as above …

  const handleBatch = async () => {
    const translator = translatorRef.current;
    if (!translator) return;
    const inputs = ["Hallo Welt", "Guten Morgen", "Wie geht es dir?"];
    const results = await translator.translateBatch(inputs);
    setOutputs(results.map((r) => r.text));
  };

  return (
    <div>
      <button onClick={handleBatch}>Translate all</button>
      <ul>
        {outputs.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
    </div>
  );
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

The store lives inside core (`TranslationStore`). React binds to it via
`useSyncExternalStore`, which is the idiomatic way to consume an external
mutable store in React 18.

### Step 1: Hook — `useTranslation()`

> **`snapshot()` returns a cached, frozen reference.** Since F1
> (Store-Snapshot Caching), `TranslationStore.snapshot()` returns the same
> object when the store hasn't changed — no `Object.fromEntries()` per call.
> This means `useSyncExternalStore` can use `() => store.snapshot()` directly
> as `getSnapshot` without infinite re-render loops. No shallow-equal
> workaround needed.

```tsx
// src/useTranslation.ts
import { useEffect, useRef, useSyncExternalStore } from "react";
import { type Translator } from "@lite-translator/core";

/**
 * Returns `{ t, translateAll }` for a translator. `t(key, text)` registers and
 * reads a string; `translateAll()` translates everything in one batch.
 *
 * The store snapshot is cached and frozen inside core (F1), so
 * `useSyncExternalStore` can use `() => store.snapshot()` directly — no
 * shallow-equal workaround needed.
 */
export function useTranslation(translator: Translator | null) {
  const tRef = useRef<((key: string, text?: string) => string) | null>(null);
  const store = translator?.store();

  // Lazily create the bound t() once per translator.
  if (translator && !tRef.current) {
    tRef.current = translator.t();
  }

  // Subscribe to store changes for re-render after translateAll().
  // snapshot() returns a stable frozen reference when unchanged (F1).
  const snapshot = useSyncExternalStore(
    (cb) => store?.subscribe(cb) ?? (() => {}),
    () => store?.snapshot() ?? {},
    () => ({}), // SSR
  );

  useEffect(() => {
    return () => {
      tRef.current = null;
    };
  }, [translator]);

  const t = tRef.current ?? ((key: string) => key);
  const translateAll = () => translator?.translateAll();
  return { t, translateAll, snapshot };
}
```

### Step 2: Components — register strings, read reactively

```tsx
// src/Header.tsx
import { type Translator } from "@lite-translator/core";
import { useTranslation } from "./useTranslation";

export function Header({ translator }: { translator: Translator | null }) {
  const { t, snapshot } = useTranslation(translator);
  // Register on first render; t() returns the original synchronously.
  t("header.title", "Willkommen");
  t("header.subtitle", "Bitte wählen Sie eine Sprache");

  return (
    <header>
      <h1>{snapshot["header.title"] ?? "Willkommen"}</h1>
      <p>{snapshot["header.subtitle"] ?? "Bitte wählen Sie eine Sprache"}</p>
    </header>
  );
}

// src/Footer.tsx
export function Footer({ translator }: { translator: Translator | null }) {
  const { t, snapshot } = useTranslation(translator);
  t("footer.button", "Bestätigen");
  t("footer.link", "Abbrechen");

  return (
    <footer>
      <button>{snapshot["footer.button"] ?? "Bestätigen"}</button>
      <a href="#">{snapshot["footer.link"] ?? "Abbrechen"}</a>
    </footer>
  );
}
```

### Step 3: Toolbar — one click, all components translated

```tsx
// src/Toolbar.tsx
import { useState } from "react";
import { type Translator } from "@lite-translator/core";
import { useTranslation } from "./useTranslation";

export function Toolbar({ translator }: { translator: Translator | null }) {
  const { translateAll } = useTranslation(translator);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!translator) return;
    setLoading(true);
    try {
      await translateAll();
      // → 1× translateBatch(["Willkommen", "Bitte wählen…", "Bestätigen", "Abbrechen"])
      // → useSyncExternalStore triggers re-render in Header and Footer
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handleClick} disabled={loading}>
      {loading ? "Translating…" : "Translate all"}
    </button>
  );
}
```

> **Synchronous first render:** `t(key, text)` returns the original text
> immediately, so the first paint shows German. After `translateAll()`, the
> store notifies `useSyncExternalStore` and all components re-render in
> English — no manual state per component.
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
React binding.

```tsx
// src/LiveTranslator.tsx
import { useEffect, useRef, useState } from "react";
import { type LiveSession, type LiveTranslationEvent, type Translator } from "@lite-translator/core";

export function LiveTranslator({ translator }: { translator: Translator | null }) {
  const [input, setInput] = useState("Hallo Welt. Wie geht es dir?");
  const [text, setText] = useState("");
  const [partial, setPartial] = useState("");
  const sessionRef = useRef<LiveSession | null>(null);

  // Create/dispose the live session together with the translator.
  useEffect(() => {
    if (!translator) return;
    const live = translator.createLiveSession({ debounce: 250 });
    sessionRef.current = live;
    const off = live.on("translation", (e: LiveTranslationEvent) => {
      setText(e.text);
      setPartial(e.partial);
    });
    return () => {
      off();
      live.dispose();
      sessionRef.current = null;
    };
  }, [translator]);

  return (
    <div style={{ maxWidth: 480, display: "grid", gap: 12 }}>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={4} />
      <output style={{ whiteSpace: "pre-wrap" }}>{text}</output>
      <output style={{ opacity: 0.6 }}>{partial}</output>
    </div>
  );
}
```

- Completed sentences stay stable (cached); only the active fragment updates.
- The `useEffect` cleanup disposes the session when the translator changes or
  the component unmounts — canceling pending debounced work.
- For speech-to-text, feed `live.update(text)` from the recognizer's `onresult`
  handler and render `e.segments` filtered by `complete` for the stable area.

## Multi-language (switching target languages)

Each `Translator` instance is bound to exactly one language pair (`from`/`to`).
To let the user switch languages at runtime, use `TranslatorPool` — it caches
translators by pair and reuses the one already created. An optional `maxSize`
enables LRU eviction of the oldest cached translator.

```tsx
// src/MultiLanguageTranslator.tsx
import { useRef, useState } from "react";
import {
  TranslatorPool,
  formatTranslatorError,
} from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

export function MultiLanguageTranslator() {
  const [from, setFrom] = useState("de");
  const [to, setTo] = useState("en");
  const [input, setInput] = useState("Hallo Welt");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const poolRef = useRef<TranslatorPool>();

  if (!poolRef.current) {
    poolRef.current = new TranslatorPool({
      engines: [createOnnxEngine()],
      maxSize: 3, // dispose oldest translator beyond this limit
    });
  }

  const handleTranslate = async () => {
    setLoading(true);
    setOutput("");
    try {
      const translator = await poolRef.current.switchTo(from, to);
      const result = await translator.translate(input);
      setOutput(result.text);
    } catch (err) {
      setOutput(formatTranslatorError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 480, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <label>
          From:{" "}
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </label>
        <label>
          To:{" "}
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="fr">Français</option>
          </select>
        </label>
      </div>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={4} />
      <button onClick={handleTranslate} disabled={loading}>
        {loading ? "Translating…" : "Translate"}
      </button>
      <output style={{ whiteSpace: "pre-wrap" }}>{output}</output>
    </div>
  );
}
```

- Unsupported pairs throw `LANGUAGE_PAIR_NOT_SUPPORTED` immediately — show a
  friendly message. See [language-selection.md](language-selection.md) for the
  full list of built-in pairs and how to register custom ones.
- Engines and loaded models are shared across translators created from the
  same `createOnnxEngine()` instance; switching back to a previous pair reuses
  the cached model instantly.
- Dispose translators you no longer need with `await poolRef.current.dispose()`
  (e.g. on app logout). The engine worker terminates when the last translator
  is disposed — or keep the engine alive for the whole app lifetime.

## Notes

- **Lazy loading:** `createTranslator()` does not load a model yet. Only `translate()` or `preload()` loads the model from the Hugging Face Hub. On the first call, the progress bar appears.
- **Cleanup:** The `useEffect` cleanup calls `dispose()` so the web worker terminates on unmount (otherwise it stays running in the background).
- **Offline:** After the first download, translation works without a network connection. Use `await translator.isCached()` to check whether the model is already stored locally.
- **Multiple language pairs:** Create a separate translator for each language pair (`from`/`to` are bound to the instance).
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts) — use `formatTranslatorError()` for consistent error strings. For example, catch `OFFLINE_MODEL_MISSING` to warn users about a missing offline cache.
- **Vite/Create React version:** Both bundlers support the `new URL("./worker.js", import.meta.url)` pattern natively. No extra configuration is needed.