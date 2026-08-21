/// <reference types="@vitest/browser/providers/playwright" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    "import.meta.env.VITE_MODEL_ID_DE_EN": JSON.stringify(
      process.env.VITE_MODEL_ID_DE_EN ?? "Xenova/opus-mt-de-en",
    ),
    "import.meta.env.VITE_MODEL_ID_EN_DE": JSON.stringify(
      process.env.VITE_MODEL_ID_EN_DE ?? "Xenova/opus-mt-en-de",
    ),
    "import.meta.env.VITE_MODEL_ID_FR_EN": JSON.stringify(
      process.env.VITE_MODEL_ID_FR_EN ?? "Xenova/opus-mt-fr-en",
    ),
    "import.meta.env.VITE_MODEL_ID_EN_FR": JSON.stringify(
      process.env.VITE_MODEL_ID_EN_FR ?? "Xenova/opus-mt-en-fr",
    ),
    "import.meta.env.VITE_MODEL_ID_ES_EN": JSON.stringify(
      process.env.VITE_MODEL_ID_ES_EN ?? "Xenova/opus-mt-es-en",
    ),
    "import.meta.env.VITE_MODEL_ID_EN_ES": JSON.stringify(
      process.env.VITE_MODEL_ID_EN_ES ?? "Xenova/opus-mt-en-es",
    ),
    "import.meta.env.VITE_MODEL_ID_IT_EN": JSON.stringify(
      process.env.VITE_MODEL_ID_IT_EN ?? "Xenova/opus-mt-it-en",
    ),
    "import.meta.env.VITE_MODEL_ID_EN_IT": JSON.stringify(
      process.env.VITE_MODEL_ID_EN_IT ?? "Xenova/opus-mt-en-it",
    ),
    "import.meta.env.VITE_MODEL_ID_NL_EN": JSON.stringify(
      process.env.VITE_MODEL_ID_NL_EN ?? "Xenova/opus-mt-nl-en",
    ),
    "import.meta.env.VITE_MODEL_ID_EN_NL": JSON.stringify(
      process.env.VITE_MODEL_ID_EN_NL ?? "Xenova/opus-mt-en-nl",
    ),
  },
  test: {
    include: ["tests/**/*.browser.test.ts"],
    testTimeout: 600000,
    hookTimeout: 600000,
    browser: {
      enabled: true,
      provider: "playwright",
      instances: [{ browser: "chromium" }],
      headless: true,
    },
  },
});
