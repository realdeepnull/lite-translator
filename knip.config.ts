import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    ".": {
      entry: ["knip.config.ts"],
      project: ["*.{js,ts}"],
    },
    "packages/core": {
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
    "packages/engine-onnx": {
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
  },
  ignoreBinaries: ["publint", "attw", "playwright"],
};

export default config;
