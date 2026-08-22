# Integration: Vue 3

This guide shows how to use `@lite-translator/core` and `@lite-translator/engine-onnx` in a Vue 3 app (Composition API, `<script setup>`).

## Installation

```sh
npm install @lite-translator/core @lite-translator/engine-onnx
```

## Example: translator component

```vue
<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from "vue";
import {
  createTranslator,
  formatTranslatorError,
  type Translator,
  type ProgressEvent,
} from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const input = ref("Hallo Welt, wie geht es dir?");
const output = ref("");
const loading = ref(false);
const progress = ref(0);

// shallowRef because Translator is a complex object (no reactivity needed)
const translator = shallowRef<Translator | null>(null);

(async () => {
  translator.value = await createTranslator({
    from: "de",
    to: "en",
    engines: [createOnnxEngine()],
    onProgress: (e: ProgressEvent) => {
      if (Number.isFinite(e.progress)) progress.value = e.progress;
    },
  });
})();

onBeforeUnmount(() => {
  void translator.value?.dispose();
  translator.value = null;
});

async function handleTranslate() {
  if (!translator.value) return;
  loading.value = true;
  output.value = "";
  try {
    const result = await translator.value.translate(input.value);
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
    <textarea v-model="input" rows={4} />
    <button :disabled="loading" @click="handleTranslate">
      {{ loading ? "Translating…" : "Translate" }}
    </button>
    <progress v-if="loading" max="1" :value="progress" style="width: 100%" />
    <output style="white-space: pre-wrap">{{ output }}</output>
  </div>
</template>
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

```vue
<script setup lang="ts">
import { ref, shallowRef, onBeforeUnmount } from "vue";
import { createTranslator, type Translator } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const inputs = ["Hallo Welt", "Guten Morgen", "Wie geht es dir?"];
const outputs = ref<string[]>([]);
const translator = shallowRef<Translator | null>(null);

(async () => {
  translator.value = await createTranslator({
    from: "de",
    to: "en",
    engines: [createOnnxEngine()],
  });
})();

onBeforeUnmount(() => {
  void translator.value?.dispose();
  translator.value = null;
});

async function handleBatch() {
  if (!translator.value) return;
  const results = await translator.value.translateBatch(inputs);
  outputs.value = results.map((r) => r.text);
}
</script>

<template>
  <button @click="handleBatch">Translate all</button>
  <ul>
    <li v-for="(text, i) in outputs" :key="i">{{ text }}</li>
  </ul>
</template>
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

The store lives inside core (`TranslationStore`). Vue binds to it via a
`reactive()` snapshot that is refreshed on store notifications. Since `snapshot()`
returns a cached, frozen reference (F1), the subscribe callback can simply
`Object.assign` the new values into the reactive object.

### Step 1: Composable — `useTranslation()`

```ts
// src/useTranslation.ts
import { reactive, shallowRef, onBeforeUnmount, watch } from "vue";
import { type Translator } from "@lite-translator/core";

/**
 * Returns `{ t, translateAll, translations }` for a translator.
 * `translations` is a reactive object that updates after `translateAll()`.
 *
 * Uses `watch` on `translator` so the store subscription is properly cleaned
 * up when the translator changes. Since `snapshot()` returns a cached frozen
 * reference (F1), the subscribe callback can `Object.assign` directly.
 */
export function useTranslation(translator: Translator | null) {
  const tFn = shallowRef<((key: string, text?: string) => string) | null>(null);
  const translations = reactive<Record<string, string>>({});

  watch(
    () => translator,
    (t, _old, onCleanup) => {
      if (!t) {
        tFn.value = null;
        return;
      }
      tFn.value = t.t();
      const store = t.store()!;
      const unsub = store.subscribe(() => {
        // snapshot() is cached + frozen (F1) — assign directly.
        const snap = store.snapshot();
        for (const key of Object.keys(translations)) {
          if (!(key in snap)) delete translations[key];
        }
        for (const [key, value] of Object.entries(snap)) {
          translations[key] = value;
        }
      });
      onCleanup(() => unsub());
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    tFn.value = null;
  });

  const t = tFn.value ?? ((key: string) => key);
  const translateAll = () => translator?.translateAll();
  return { t, translateAll, translations };
}
```

### Step 2: Components — register strings, read reactively

```vue
<!-- src/Header.vue -->
<script setup lang="ts">
import { type Translator } from "@lite-translator/core";
import { useTranslation } from "./useTranslation";

const props = defineProps<{ translator: Translator | null }>();
const { t, translations } = useTranslation(props.translator);
// Register on setup; t() returns the original synchronously.
t("header.title", "Willkommen");
t("header.subtitle", "Bitte wählen Sie eine Sprache");
</script>

<template>
  <header>
    <h1>{{ translations["header.title"] ?? "Willkommen" }}</h1>
    <p>{{ translations["header.subtitle"] ?? "Bitte wählen Sie eine Sprache" }}</p>
  </header>
</template>
```

```vue
<!-- src/Footer.vue -->
<script setup lang="ts">
import { type Translator } from "@lite-translator/core";
import { useTranslation } from "./useTranslation";

const props = defineProps<{ translator: Translator | null }>();
const { t, translations } = useTranslation(props.translator);
t("footer.button", "Bestätigen");
t("footer.link", "Abbrechen");
</script>

<template>
  <footer>
    <button>{{ translations["footer.button"] ?? "Bestätigen" }}</button>
    <a href="#">{{ translations["footer.link"] ?? "Abbrechen" }}</a>
  </footer>
</template>
```

### Step 3: Toolbar — one click, all components translated

```vue
<!-- src/Toolbar.vue -->
<script setup lang="ts">
import { ref } from "vue";
import { type Translator } from "@lite-translator/core";
import { useTranslation } from "./useTranslation";

const props = defineProps<{ translator: Translator | null }>();
const { translateAll } = useTranslation(props.translator);
const loading = ref(false);

async function onTranslateAll() {
  if (!props.translator) return;
  loading.value = true;
  try {
    await translateAll();
    // → 1× translateBatch(["Willkommen", "Bitte wählen…", "Bestätigen", "Abbrechen"])
    // → translations in Header.vue and Footer.vue update automatically
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <button :disabled="loading" @click="onTranslateAll">
    {{ loading ? "Übersetze…" : "Alle übersetzen" }}
  </button>
</template>
```

> **Synchronous first render:** `t(key, text)` returns the original text
> immediately, so the first paint shows German. After `translateAll()`, the
> store notifies the composable and `translations` updates — Vue re-renders
> all components automatically.
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
Vue 3 binding.

```vue
<!-- src/LiveTranslator.vue -->
<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { type LiveSession, type Translator } from "@lite-translator/core";

const props = defineProps<{ translator: Translator | null }>();

const input = ref("Hallo Welt. Wie geht es dir?");
const text = ref("");
const partial = ref("");
const session = shallowRef<LiveSession | null>(null);

// Create/dispose the live session whenever the translator changes.
watch(
  () => props.translator,
  (t) => {
    session.value?.dispose();
    text.value = "";
    partial.value = "";
    if (!t) {
      session.value = null;
      return;
    }
    const live = t.createLiveSession({ debounce: 250 });
    live.on("translation", (e) => {
      text.value = e.text;
      partial.value = e.partial;
    });
    session.value = live;
  },
  { immediate: true },
);

function onInput() {
  session.value?.update(input.value);
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
- The `watch` cleanup disposes the session when the translator changes or the
  component unmounts — canceling pending debounced work.
- For speech-to-text, feed `live.update(text)` from the recognizer's `onresult`
  handler and render `e.segments` filtered by `complete` for the stable area.

## Multi-language (switching target languages)

Each `Translator` instance is bound to exactly one language pair (`from`/`to`).
To let the user switch languages at runtime, use `TranslatorPool` — it caches
translators by pair and reuses the one already created. An optional `maxSize`
enables LRU eviction of the oldest cached translator.

```vue
<!-- src/MultiLanguageTranslator.vue -->
<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import { TranslatorPool, formatTranslatorError } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const from = ref("de");
const to = ref("en");
const input = ref("Hallo Welt");
const output = ref("");
const loading = ref(false);

const pool = new TranslatorPool({
  engines: [createOnnxEngine()],
  maxSize: 3, // dispose oldest translator beyond this limit
});

async function handleTranslate() {
  loading.value = true;
  output.value = "";
  try {
    const translator = await pool.switchTo(from.value, to.value);
    const result = await translator.translate(input.value);
    output.value = result.text;
  } catch (err) {
    output.value = formatTranslatorError(err);
  } finally {
    loading.value = false;
  }
}

onBeforeUnmount(() => {
  void pool.dispose();
});
</script>

<template>
  <div style="max-width: 480px; display: grid; gap: 12px">
    <div style="display: flex; gap: 12px">
      <label>
        From:
        <select v-model="from">
          <option value="de">Deutsch</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
      </label>
      <label>
        To:
        <select v-model="to">
          <option value="en">English</option>
          <option value="de">Deutsch</option>
          <option value="fr">Français</option>
        </select>
      </label>
    </div>
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
- Engines and loaded models are shared across translators created from the
  same `createOnnxEngine()` instance; switching back to a previous pair reuses
  the cached model instantly.
- Dispose translators you no longer need with `await translator.dispose()`
  (e.g. on app logout). The engine worker terminates when the last translator
  is disposed — or keep the engine alive for the whole app lifetime.

## Notes

- **`shallowRef` for the translator:** The translator is an object with methods and an internal worker; adding reactivity here would be overhead. `shallowRef` stores the reference without tracking it deeply.
- **Lazy loading:** `createTranslator()` does not load a model yet. Only `translate()` or `preload()` loads the model from the Hugging Face Hub.
- **Cleanup:** `onBeforeUnmount` calls `dispose()` so the web worker is terminated when the component is destroyed.
- **Offline:** After the first download, translation works without a network connection. Use `await translator.value?.isCached()` to check whether the model is already stored locally.
- **Vite:** Vue 3 is typically scaffolded with Vite. Vite supports the `new URL("./worker.js", import.meta.url)` pattern natively — no extra configuration is required.
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts).