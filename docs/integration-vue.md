# Integration: Vue 3

This guide shows how to use `@lite-translator/core` and `@lite-translator/engine-onnx` in a Vue 3 app (Composition API, `<script setup>`).

## Installation

```sh
npm install @lite-translator/core @lite-translator/engine-onnx
```

## Step 1: Shared pool singleton

Vue doesn't use DI, so we create a module-level singleton: one shared engine (one Web Worker) and a `TranslatorPool` that caches translators by language pair. Import `pool` from any component.

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
  onDebug: (event) => {
    console.debug("[lite-translator]", event.type, event);
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

```vue
<script setup lang="ts">
import { ref, shallowRef } from "vue";
import { formatTranslatorError, type Translator } from "@lite-translator/core";
import { pool } from "./pool";

const from = ref("de");
const to = ref("en");
const input = ref("Hallo Welt, wie geht es dir?");
const output = ref("");
const loading = ref(false);

// shallowRef because Translator is a complex object (no deep reactivity needed)
const translator = shallowRef<Translator | null>(null);

async function getTranslator(): Promise<Translator> {
  if (!translator.value) {
    translator.value = await pool.switchTo(from.value, to.value);
  }
  return translator.value;
}

async function handleTranslate(): Promise<void> {
  loading.value = true;
  output.value = "";
  try {
    const t = await getTranslator();
    console.log(t.capabilities());
    const result = await t.translate(input.value);
    output.value = result.text;
  } catch (err) {
    output.value = formatTranslatorError(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div style="max-width: 480px; display: grid; gap: 12px">
    <textarea v-model="input" rows="4" />
    <button :disabled="loading" @click="handleTranslate">
      {{ loading ? "Translating…" : "Translate" }}
    </button>
    <output style="white-space: pre-wrap">{{ output }}</output>
  </div>
</template>
```

> **AbortSignal:** `translate()` accepts an optional `AbortSignal` via
> `{ signal }`. When the signal is already aborted, the call rejects with
> `TRANSLATION_FAILED` ("Translation aborted"). Use this to cancel
> translations when the user switches language mid-flight.
>
> **0.2.0 update:** `onDebug` is available as an opt-in lifecycle callback on
> the pool/translator and `capabilities()` exposes the resolved engine state
> (`device`, `dtype`, `modelId`, etc.) for runtime checks.
>
> **0.2.1 update:** `TranslatorPool` now forwards `onDebug` to every translator
> it creates (not just `onProgress`), and the new `inference-start` /
> `inference-done` events bracket the model call inside the worker
> (`requestId`, `batchSize`, `inputChars`, `outputChars`, `durationMs`) —
> pure inference time vs. worker/chunking overhead becomes visible. See
> [debug-output.md](debug-output.md).

## Step 3: Batch translation

`translateBatch()` translates multiple texts in a single worker roundtrip. The
ONNX engine uses native Transformers.js batching (`pipe([...])`) — one
tokenization, encoder and decoder pass for the whole batch instead of N
sequential roundtrips. Result order matches input order; empty strings are
passed through unchanged. Batches larger than 32 texts are chunked automatically.

No pool changes needed — call `translateBatch()` on the translator directly:

```vue
<script setup lang="ts">
import { ref, shallowRef } from "vue";
import { formatTranslatorError, type Translator } from "@lite-translator/core";
import { pool } from "./pool";

interface BatchState {
  title: string;
  text: string;
  translated: string;
  status: "pending" | "busy" | "done" | "error";
}

const batchRunning = ref(false);
const batchItems = ref<BatchState[]>([
  { title: "Reisebericht", text: "Letzten Sommer bin ich …", translated: "", status: "pending" },
  { title: "Kurzgeschichte", text: "Die alte Bibliothek …", translated: "", status: "pending" },
]);

const translator = shallowRef<Translator | null>(null);

async function getTranslator(): Promise<Translator> {
  if (!translator.value) {
    translator.value = await pool.switchTo("de", "en");
  }
  return translator.value;
}

async function handleBatch(): Promise<void> {
  batchRunning.value = true;
  const items = batchItems.value;
  batchItems.value = items.map((i) => ({ ...i, translated: "", status: "busy" as const }));
  try {
    const t = await getTranslator();
    const texts = items.map((i) => i.text);
    const results = await t.translateBatch(texts);
    batchItems.value = items.map((i, idx) => ({
      ...i,
      translated: results[idx]?.text ?? "",
      status: "done" as const,
    }));
  } catch (err) {
    batchItems.value = items.map((i) => ({
      ...i,
      translated: formatTranslatorError(err),
      status: "error" as const,
    }));
  } finally {
    batchRunning.value = false;
  }
}
</script>

<template>
  <button :disabled="batchRunning" @click="handleBatch">Translate all</button>
  <ul>
    <li v-for="item in batchItems" :key="item.title">
      <h3>{{ item.title }}</h3>
      <p>{{ item.text }}</p>
      <p>{{ item.translated }}</p>
    </li>
  </ul>
</template>
```

> **Performance:** For N short sentences, `translateBatch()` is typically 2–5×
> faster than N individual `translate()` calls because the fixed inference cost
> (session setup, KV-cache init, kernel dispatch) is paid once per batch.

## Step 4: i18n-style translation — `useTranslation()` composable

For UI strings spread across many components, the `t()` / `translateAll()`
pattern is simpler than managing `translateBatch()` arrays yourself. Each
component registers its strings with a single `t(key, text)` call; one
`translateAll()` triggers a **single** `translateBatch()` for all registered
strings — one inference call, no race conditions, no per-component arrays.

The store lives inside core (`TranslationStore`). Vue binds to it via a
`reactive()` snapshot that is refreshed on store notifications. Since `snapshot()`
returns a cached, frozen reference, the subscribe callback can simply copy
the new values into the reactive object.

### Composable — `useTranslation(from, to)`

The composable calls `pool.switchTo()` internally and exposes `t()`,
`translateAll()`, and a reactive `translations` object. Components don't need a
`translator` prop.

```ts
// src/useTranslation.ts
import { reactive, shallowRef, watch } from "vue";
import { type Translator } from "@lite-translator/core";
import { pool } from "./pool";

export function useTranslation(from: string, to: string) {
  const translator = shallowRef<Translator | null>(null);
  const translations = reactive<Record<string, string>>({});

  watch(
    () => [from, to] as const,
    ([f, t]) => {
      void pool.switchTo(f, t).then((tr) => {
        translator.value = tr;
        const store = tr.store();
        if (!store) return;
        store.subscribe(() => {
          const snap = store.snapshot();
          for (const key of Object.keys(translations)) {
            if (!(key in snap)) delete translations[key];
          }
          for (const [key, value] of Object.entries(snap)) {
            translations[key] = value;
          }
        });
      });
    },
    { immediate: true },
  );

  const t = (key: string, text?: string): string => {
    if (!translator.value) return key;
    return translator.value.t()(key, text);
  };

  const translateAll = async () => {
    if (translator.value) await translator.value.translateAll();
  };

  return { t, translateAll, translations, ready: translator };
}
```

### Component — register strings, read reactively, translate all

```vue
<!-- src/I18nPage.vue -->
<script setup lang="ts">
import { ref, watchEffect } from "vue";
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

const { t, translateAll, translations, ready } = useTranslation("de", "en");
const loading = ref(false);
const error = ref("");

// Register UI strings once the translator is ready
watchEffect(() => {
  if (!ready.value) return;
  for (const item of UI_STRINGS) {
    t(item.key, item.original);
  }
});

async function handleTranslateAll(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    await translateAll();
  } catch (err) {
    error.value = formatTranslatorError(err);
  } finally {
    loading.value = false;
  }
}

function value(key: string): string {
  return translations[key] ?? "";
}
</script>

<template>
  <div style="max-width: 480px; display: grid; gap: 12px">
    <button :disabled="loading || !ready" @click="handleTranslateAll">
      {{ loading ? value("toolbar.translating") : value("toolbar.translateAll") }}
    </button>
    <table>
      <tbody>
        <tr v-for="item in UI_STRINGS" :key="item.key">
          <td><code>{{ item.key }}</code></td>
          <td>{{ item.original }}</td>
          <td>{{ value(item.key) || "—" }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

> **Synchronous first render:** `t(key, text)` returns the original text
> immediately, so the first paint shows German. After `translateAll()`, the
> store notifies the composable and `translations` updates — Vue re-renders
> all components automatically.
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

```vue
<!-- src/LiveTranslationPage.vue -->
<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from "vue";
import {
  formatTranslatorError,
  type LiveSession,
  type LiveTranslationEvent,
} from "@lite-translator/core";
import { pool } from "./pool";

const input = ref("Hallo Welt. Wie geht es dir?");
const text = ref("");
const partial = ref("");
const error = ref("");
const loading = ref(true);
const session = shallowRef<LiveSession | null>(null);

void pool.switchTo("de", "en").then((translator) => {
  const live = translator.createLiveSession({ debounce: 250 });
  live.on("translation", (e: LiveTranslationEvent) => {
    text.value = e.text;
    partial.value = e.partial;
  });
  live.on("error", (err) => {
    error.value = formatTranslatorError(err);
  });
  session.value = live;
  loading.value = false;
  live.update(input.value);
});

function onInput(): void {
  error.value = "";
  session.value?.update(input.value);
}

function handleClear(): void {
  input.value = "";
  text.value = "";
  partial.value = "";
  session.value?.clear();
}

onBeforeUnmount(() => {
  session.value?.dispose();
  session.value = null;
});
</script>

<template>
  <div style="max-width: 480px; display: grid; gap: 12px">
    <textarea v-model="input" rows="4" @input="onInput" />
    <output style="white-space: pre-wrap">{{ text }}</output>
    <output style="opacity: 0.6">{{ partial }}</output>
  </div>
</template>
```

- Completed sentences stay stable (cached); only the active fragment updates.
- `onBeforeUnmount` disposes the session — canceling pending debounced work.
- For speech-to-text, feed `live.update(text)` from the recognizer's `onresult`
  handler and render `e.segments` filtered by `complete` for the stable area.

## Step 6: Multi-language (switching target languages)

Each `Translator` instance is bound to exactly one language pair (`from`/`to`).
To let the user switch languages at runtime, call `pool.switchTo(from, to)` —
it caches translators by pair and reuses the one already created. No extra setup
needed; the pool singleton from Step 1 handles everything.

```vue
<!-- src/MultiLanguagePage.vue -->
<script setup lang="ts">
import { ref } from "vue";
import { formatTranslatorError } from "@lite-translator/core";
import { pool } from "./pool";

const LANGS = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
];

const from = ref("de");
const to = ref("en");
const input = ref("Hallo Welt");
const output = ref("");
const loading = ref(false);
const currentPair = ref("de-en");

async function handleTranslate(): Promise<void> {
  loading.value = true;
  output.value = "";
  try {
    const translator = await pool.switchTo(from.value, to.value);
    currentPair.value = `${from.value}-${to.value}`;
    const result = await translator.translate(input.value);
    output.value = result.text;
  } catch (err) {
    output.value = formatTranslatorError(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div style="max-width: 480px; display: grid; gap: 12px">
    <div style="display: flex; gap: 12px">
      <label>
        From:
        <select v-model="from">
          <option v-for="lang in LANGS" :key="lang.code" :value="lang.code">{{ lang.label }}</option>
        </select>
      </label>
      <label>
        To:
        <select v-model="to">
          <option v-for="lang in LANGS" :key="lang.code" :value="lang.code">{{ lang.label }}</option>
        </select>
      </label>
    </div>
    <span>Active: <code>{{ currentPair }}</code></span>
    <textarea v-model="input" rows="4" />
    <button :disabled="loading" @click="handleTranslate">
      {{ loading ? "Translating…" : "Translate" }}
    </button>
    <output style="white-space: pre-wrap">{{ output }}</output>
  </div>
</template>
```

- Unsupported pairs throw `LANGUAGE_PAIR_NOT_SUPPORTED` immediately — show a
  friendly message. See [language-selection.md](language-selection.md) for the
  full list of built-in pairs and how to register custom ones.
- The engine is created once and shared across all translators via the pool;
  switching back to a previous pair reuses the cached model instantly.
- Dispose translators you no longer need with `await pool.disposePair(from, to)`
  (e.g. on app logout).

## Notes

- **`shallowRef` for the translator:** The translator is an object with methods
  and an internal worker; adding reactivity here would be overhead. `shallowRef`
  stores the reference without tracking it deeply.
- **Lazy loading:** `pool.switchTo()` does not load a model yet. Only
  `translate()` or `preload()` loads the model from the Hugging Face Hub.
- **Offline:** After the first download, translation works without a network
  connection. Use `await translator.isCached()` to check whether the model is
  already stored locally.
- **Vite:** Vue 3 is typically scaffolded with Vite. Vite supports the
  `new URL("./worker.js", import.meta.url)` pattern natively — no extra
  configuration is required.
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts).