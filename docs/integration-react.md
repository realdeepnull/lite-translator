# Integration: React 18

This guide shows how to use `@lite-translator/core` and `@lite-translator/engine-onnx` in a React 18 app.

## Installation

```sh
npm install @lite-translator/core @lite-translator/engine-onnx
```

## Step 1: Shared pool singleton

React doesn't use DI, so we create a module-level singleton: one shared engine (one Web Worker) and a `TranslatorPool` that caches translators by language pair. Import `pool` from any component.

```ts
// src/pool.ts
import { TranslatorPool, type ProgressEvent } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const engine = createOnnxEngine();

let progressCallback: ((e: ProgressEvent) => void) | null = null;

export const pool = new TranslatorPool({
  engines: [engine],
  onProgress: (e: ProgressEvent) => {
    if (Number.isFinite(e.progress)) {
      progressCallback?.(e);
    },
  },
});

export function setProgressCallback(cb: ((e: ProgressEvent) => void) | null): void {
  progressCallback = cb;
}
```

> **Rule of thumb:** call `createOnnxEngine()` **exactly once** per app lifetime.
> The singleton above does it correctly. Creating the engine inside a component
> spawns a new Web Worker per mount (~30–50 MB each).

## Step 2: Basic component — translate

```tsx
// src/DemoPage.tsx
import { useRef, useState } from "react";
import { formatTranslatorError, type Translator } from "@lite-translator/core";
import { pool } from "./pool";

export function DemoPage() {
  const [from, setFrom] = useState("de");
  const [to, setTo] = useState("en");
  const [input, setInput] = useState("Hallo Welt, wie geht es dir?");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const translatorRef = useRef<Translator | null>(null);

  async function getTranslator(): Promise<Translator> {
    if (!translatorRef.current) {
      translatorRef.current = await pool.switchTo(from, to);
    }
    return translatorRef.current;
  }

  async function handleTranslate() {
    setLoading(true);
    setOutput("");
    try {
      const t = await getTranslator();
      const result = await t.translate(input);
      setOutput(result.text);
    } catch (err) {
      setOutput(formatTranslatorError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, display: "grid", gap: 12 }}>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={4} />
      <button onClick={handleTranslate} disabled={loading}>
        {loading ? "Translating…" : "Translate"}
      </button>
      <output style={{ whiteSpace: "pre-wrap" }}>{output}</output>
    </div>
  );
}
```

> **AbortSignal:** `translate()` accepts an optional `AbortSignal` via
> `{ signal }`. When the signal is already aborted, the call rejects with
> `TRANSLATION_FAILED` ("Translation aborted"). Use this to cancel
> translations when the user switches language mid-flight.

## Step 3: Batch translation

`translateBatch()` translates multiple texts in a single worker roundtrip. The
ONNX engine uses native Transformers.js batching (`pipe([...])`) — one
tokenization, encoder and decoder pass for the whole batch instead of N
sequential roundtrips. Result order matches input order; empty strings are
passed through unchanged. Batches larger than 32 texts are chunked automatically.

No pool changes needed — call `translateBatch()` on the translator directly:

```tsx
async function handleBatch() {
  setBatchRunning(true);
  try {
    const t = await getTranslator();
    const texts = batchItems.map((i) => i.text);
    const results = await t.translateBatch(texts);
    setBatchItems(batchItems.map((item, i) => ({
      ...item,
      translated: results[i]?.text ?? "",
      status: "done" as const,
    })));
  } catch (err) {
    setBatchItems(batchItems.map((item) => ({
      ...item,
      translated: formatTranslatorError(err),
      status: "error" as const,
    })));
  } finally {
    setBatchRunning(false);
  }
}
```

> **Performance:** For N short sentences, `translateBatch()` is typically 2–5×
> faster than N individual `translate()` calls because the fixed inference cost
> (session setup, KV-cache init, kernel dispatch) is paid once per batch.

## Step 4: i18n-style translation — `useTranslation()` hook

For UI strings spread across many components, the `t()` / `translateAll()`
pattern is simpler than managing `translateBatch()` arrays yourself. Each
component registers its strings with a single `t(key, text)` call; one
`translateAll()` triggers a **single** `translateBatch()` for all registered
strings — one inference call, no race conditions, no per-component arrays.

The store lives inside core (`TranslationStore`). React binds to it via
`useSyncExternalStore`, which is the idiomatic way to consume an external
mutable store in React 18.

> **`snapshot()` returns a cached, frozen reference.** Since the
> Store-Snapshot Caching optimization, `TranslationStore.snapshot()` returns
> the same object when the store hasn't changed. This means
> `useSyncExternalStore` can use `() => store.snapshot()` directly as
> `getSnapshot` without infinite re-render loops. No shallow-equal
> workaround needed.

### Hook — `useTranslation(from, to)`

The hook calls `pool.switchTo()` internally and exposes `t()`, `translateAll()`,
and a reactive `snapshot`. Components don't need a `translator` prop.

```tsx
// src/useTranslation.ts
import { useEffect, useState, useSyncExternalStore } from "react";
import { type Translator } from "@lite-translator/core";
import { pool } from "./pool";

const EMPTY_SNAPSHOT: Record<string, string> = Object.freeze({});

export function useTranslation(from: string, to: string) {
  const [translator, setTranslator] = useState<Translator | null>(null);

  useEffect(() => {
    let cancelled = false;
    void pool.switchTo(from, to).then((t) => {
      if (!cancelled) setTranslator(t);
    });
    return () => { cancelled = true; };
  }, [from, to]);

  const store = translator?.store();

  const snapshot = useSyncExternalStore(
    (cb) => store?.subscribe(cb) ?? (() => {}),
    () => store?.snapshot() ?? EMPTY_SNAPSHOT,
    () => EMPTY_SNAPSHOT, // SSR
  );

  const t = (key: string, text?: string): string => {
    if (!translator) return key;
    return translator.t()(key, text);
  };

  const translateAll = async () => {
    if (translator) await translator.translateAll();
  };

  return { t, translateAll, snapshot, ready: !!translator };
}
```

### Component — register strings, read reactively, translate all

```tsx
// src/I18nPage.tsx
import { useEffect, useState } from "react";
import { formatTranslatorError } from "@lite-translator/core";
import { useTranslation } from "./useTranslation";

const UI_STRINGS = [
  { key: "header.title", original: "Willkommen", section: "header" },
  { key: "header.subtitle", original: "Bitte wählen Sie eine Sprache", section: "header" },
  { key: "footer.button", original: "Bestätigen", section: "footer" },
  { key: "footer.link", original: "Abbrechen", section: "footer" },
  { key: "toolbar.translateAll", original: "Alle übersetzen", section: "toolbar" },
  { key: "toolbar.translating", original: "Übersetze …", section: "toolbar" },
];

export function I18nPage() {
  const { t, translateAll, snapshot, ready } = useTranslation("de", "en");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Register UI strings once the translator is ready
  useEffect(() => {
    if (!ready) return;
    for (const item of UI_STRINGS) {
      t(item.key, item.original);
    }
  }, [ready]);

  const handleTranslateAll = async () => {
    setLoading(true);
    setError("");
    try {
      await translateAll();
    } catch (err) {
      setError(formatTranslatorError(err));
    } finally {
      setLoading(false);
    }
  };

  const value = (key: string) => snapshot[key] ?? "";

  return (
    <div style={{ maxWidth: 480, display: "grid", gap: 12 }}>
      <button onClick={handleTranslateAll} disabled={loading || !ready}>
        {loading ? value("toolbar.translating") : value("toolbar.translateAll")}
      </button>
      <table>
        <tbody>
          {UI_STRINGS.map((item) => (
            <tr key={item.key}>
              <td><code>{item.key}</code></td>
              <td>{item.original}</td>
              <td>{value(item.key) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
>
> **Cross-component:** Multiple components calling `useTranslation("de", "en")`
> share the same translator (cached by the pool) and the same store. Each
> component registers its own strings; one `translateAll()` translates all.

## Step 5: Live translation (while typing)

`translator.createLiveSession({ debounce })` translates **while the user
types** — ideal for chat messages or speech-to-text. The session segments the
input at sentence boundaries, caches translations of completed sentences, and
only re-translates the still-growing tail on each `update()`. Outdated results
are discarded automatically.

See [live-translation.md](live-translation.md) for the full concept.

```tsx
// src/LiveTranslationPage.tsx
import { useEffect, useRef, useState } from "react";
import {
  formatTranslatorError,
  type LiveSession,
  type LiveTranslationEvent,
} from "@lite-translator/core";
import { pool } from "./pool";

export function LiveTranslationPage() {
  const [input, setInput] = useState("Hallo Welt. Wie geht es dir?");
  const [text, setText] = useState("");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<LiveSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    void pool.switchTo("de", "en").then((translator) => {
      if (cancelled) return;
      const live = translator.createLiveSession({ debounce: 250 });
      sessionRef.current = live;

      live.on("translation", (e: LiveTranslationEvent) => {
        setText(e.text);
        setPartial(e.partial);
      });
      live.on("error", (err) => setError(formatTranslatorError(err)));

      setLoading(false);
      live.update(input);
    });

    return () => {
      cancelled = true;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onInput = (value: string) => {
    setInput(value);
    sessionRef.current?.update(value);
  };

  return (
    <div style={{ maxWidth: 480, display: "grid", gap: 12 }}>
      <textarea value={input} onChange={(e) => onInput(e.target.value)} rows={4} />
      <output style={{ whiteSpace: "pre-wrap" }}>{text}</output>
      <output style={{ opacity: 0.6 }}>{partial}</output>
    </div>
  );
}
```

- Completed sentences stay stable (cached); only the active fragment updates.
- The `useEffect` cleanup disposes the session when the component unmounts —
  canceling pending debounced work.
- For speech-to-text, feed `live.update(text)` from the recognizer's `onresult`
  handler and render `e.segments` filtered by `complete` for the stable area.

## Step 6: Multi-language (switching target languages)

Each `Translator` instance is bound to exactly one language pair (`from`/`to`).
To let the user switch languages at runtime, call `pool.switchTo(from, to)` —
it caches translators by pair and reuses the one already created. No extra setup
needed; the pool singleton from Step 1 handles everything.

```tsx
// src/MultiLanguagePage.tsx
import { useState } from "react";
import { formatTranslatorError } from "@lite-translator/core";
import { pool } from "./pool";

const LANGS = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
];

export function MultiLanguagePage() {
  const [from, setFrom] = useState("de");
  const [to, setTo] = useState("en");
  const [input, setInput] = useState("Hallo Welt");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPair, setCurrentPair] = useState("de-en");

  const handleTranslate = async () => {
    setLoading(true);
    setOutput("");
    try {
      const translator = await pool.switchTo(from, to);
      setCurrentPair(`${from}-${to}`);
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
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <label>
          To:{" "}
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
      </div>
      <span>Active: <code>{currentPair}</code></span>
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
- The engine is created once and shared across all translators via the pool;
  switching back to a previous pair reuses the cached model instantly.
- Dispose translators you no longer need with `await pool.disposePair(from, to)`
  (e.g. on app logout).

## Notes

- **Lazy loading:** `pool.switchTo()` does not load a model yet. Only
  `translate()` or `preload()` loads the model from the Hugging Face Hub.
- **Offline:** After the first download, translation works without a network
  connection. Use `await translator.isCached()` to check whether the model is
  already stored locally.
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts)
  — use `formatTranslatorError()` for consistent error strings.
- **Vite/Create React App:** Both bundlers support the
  `new URL("./worker.js", import.meta.url)` pattern natively. No extra
  configuration is needed.