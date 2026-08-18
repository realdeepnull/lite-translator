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
