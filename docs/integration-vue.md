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

## Notes

- **`shallowRef` for the translator:** The translator is an object with methods and an internal worker; adding reactivity here would be overhead. `shallowRef` stores the reference without tracking it deeply.
- **Lazy loading:** `createTranslator()` does not load a model yet. Only `translate()` or `preload()` loads the model from the Hugging Face Hub.
- **Cleanup:** `onBeforeUnmount` calls `dispose()` so the web worker is terminated when the component is destroyed.
- **Offline:** After the first download, translation works without a network connection. Use `await translator.value?.isCached()` to check whether the model is already stored locally.
- **Vite:** Vue 3 is typically scaffolded with Vite. Vite supports the `new URL("./worker.js", import.meta.url)` pattern natively — no extra configuration is required.
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts).