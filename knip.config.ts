import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    ".": {
      entry: [
        "knip.config.ts",
        "bench/quality/quality.browser.test.ts",
        "bench/quality/cases.ts",
        "bench/benchmark/benchmark.browser.test.ts",
        "bench/benchmark/long-text.browser.test.ts",
        "bench/benchmark/types.ts",
      ],
      project: ["*.{js,ts}", "bench/**/*.ts"],
      ignore: ["bench/env.d.ts", "bench/benchmark/vitest.config.ts"],
      ignoreDependencies: ["@lite-translator/engine-onnx"],
    },
    "packages/core": {
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
    "packages/engine-onnx": {
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
  },
  ignoreBinaries: ["publint", "attw"],
};

export default config;
