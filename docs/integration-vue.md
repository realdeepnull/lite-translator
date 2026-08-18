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

## Notes

- **`shallowRef` for the translator:** The translator is an object with methods and an internal worker; adding reactivity here would be overhead. `shallowRef` stores the reference without tracking it deeply.
- **Lazy loading:** `createTranslator()` does not load a model yet. Only `translate()` or `preload()` loads the model from the Hugging Face Hub.
- **Cleanup:** `onBeforeUnmount` calls `dispose()` so the web worker is terminated when the component is destroyed.
- **Offline:** After the first download, translation works without a network connection. Use `await translator.value?.isCached()` to check whether the model is already stored locally.
- **Vite:** Vue 3 is typically scaffolded with Vite. Vite supports the `new URL("./worker.js", import.meta.url)` pattern natively — no extra configuration is required.
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts).