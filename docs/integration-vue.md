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
    output.value = `Error: ${(err as { code?: string }).code ?? "UNKNOWN"}`;
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
    <progress v-if="loading" max="1" :value="progress" style="width: 100%" />
    <output style="white-space: pre-wrap">{{ output }}</output>
  </div>
</template>
```

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
`reactive()` snapshot that is refreshed on store notifications.

### Step 1: Composable — `useTranslation()`

```ts
// src/useTranslation.ts
import { reactive, shallowRef, onBeforeUnmount } from "vue";
import { type Translator } from "@lite-translator/core";

/**
 * Returns `{ t, translateAll, translations }` for a translator.
 * `translations` is a reactive object that updates after `translateAll()`.
 */
export function useTranslation(translator: Translator | null) {
  const tFn = shallowRef<((key: string, text?: string) => string) | null>(null);
  const translations = reactive<Record<string, string>>({});
  let unsubscribe: (() => void) | null = null;

  if (translator) {
    tFn.value = translator.t();
    const store = translator.store()!;
    unsubscribe = store.subscribe(() => {
      const snap = store.snapshot();
      // Replace keys without losing reactivity (in-place update).
      for (const key of Object.keys(translations)) {
        if (!(key in snap)) delete translations[key];
      }
      for (const [key, value] of Object.entries(snap)) {
        translations[key] = value;
      }
    });
  }

  onBeforeUnmount(() => {
    unsubscribe?.();
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

## Notes

- **`shallowRef` for the translator:** The translator is an object with methods and an internal worker; adding reactivity here would be overhead. `shallowRef` stores the reference without tracking it deeply.
- **Lazy loading:** `createTranslator()` does not load a model yet. Only `translate()` or `preload()` loads the model from the Hugging Face Hub.
- **Cleanup:** `onBeforeUnmount` calls `dispose()` so the web worker is terminated when the component is destroyed.
- **Offline:** After the first download, translation works without a network connection. Use `await translator.value?.isCached()` to check whether the model is already stored locally.
- **Vite:** Vue 3 is typically scaffolded with Vite. Vite supports the `new URL("./worker.js", import.meta.url)` pattern natively — no extra configuration is required.
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts).