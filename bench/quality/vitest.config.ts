/// <reference types="@vitest/browser/providers/playwright" />
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));
const engineDir = fileURLToPath(new URL("../../packages/engine-onnx", import.meta.url));

export default defineConfig({
  define: {
    "import.meta.env.VITE_MODEL_ID_DE_EN": JSON.stringify(
      process.env.VITE_MODEL_ID_DE_EN ?? "Xenova/opus-mt-de-en",
    ),
    "import.meta.env.VITE_MODEL_ID_EN_DE": JSON.stringify(
      process.env.VITE_MODEL_ID_EN_DE ?? "Xenova/opus-mt-en-de",
    ),
  },
  // Serve from engine-onnx root so dist/ (with .wasm files) is at the server root —
  // this mirrors the working existing browser tests run from packages/engine-onnx/.
  root: engineDir,
  server: {
    fs: {
      allow: [rootDir],
    },
  },
  test: {
    // Point at bench test files (relative to root=packages/engine-onnx).
    include: ["../../bench/quality/*.browser.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    browser: {
      enabled: true,
      provider: "playwright",
      instances: [{ browser: "chromium" }],
      headless: true,
    },
  },
});