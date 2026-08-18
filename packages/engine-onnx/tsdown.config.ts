import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    worker: "src/worker.ts",
  },
  platform: "browser",
  format: ["esm"],
  // Deklarationen werden pro Einstiegspunkt erzeugt; worker.d.ts exportieren wir nicht.
  dts: true,
  // Beide Workspace-/Peer-Dependencies inline bündeln, damit die dist-
  // Bundles im Browser (Demo, native ESM, Import-Maps) ohne Bundler
  // lauffähig sind. @huggingface/transformers ist eine schwere WASM-Dep
  // und muss im Worker besonders inline sein, da Browser Bare Imports
  // im Worker nicht auflösen können.
  noExternal: ["@lite-translator/core", "@huggingface/transformers"],
});
