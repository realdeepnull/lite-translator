/**
 * Node script: measures gzip bundle sizes of the built packages.
 *
 * Run with:
 *   node --experimental-strip-types bench/benchmark/bundle-size.ts
 *
 * Requires `npm run build` to have produced `dist/` in both packages.
 * Output is a single JSON line: BUNDLE_RESULT <json>
 */

import { statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface FileSize {
  path: string;
  rawBytes: number;
  gzipBytes: number;
}

interface BundleResult {
  timestamp: string;
  files: FileSize[];
  totalRawBytes: number;
  totalGzipBytes: number;
}

const root = resolve(import.meta.dirname, "..", "..");

const targets = [
  "packages/core/dist/index.js",
  "packages/engine-onnx/dist/index.js",
  "packages/engine-onnx/dist/worker.js",
];

const files: FileSize[] = [];
let totalRaw = 0;
let totalGzip = 0;

for (const rel of targets) {
  const abs = resolve(root, rel);
  let raw: number;
  try {
    raw = statSync(abs).size;
  } catch {
    console.error(`[bundle-size] missing: ${abs} — run "npm run build" first`);
    process.exitCode = 1;
    continue;
  }
  const buf = readFileSync(abs);
  const gzip = gzipSync(buf).length;
  files.push({ path: rel, rawBytes: raw, gzipBytes: gzip });
  totalRaw += raw;
  totalGzip += gzip;
}

const result: BundleResult = {
  timestamp: new Date().toISOString(),
  files,
  totalRawBytes: totalRaw,
  totalGzipBytes: totalGzip,
};

console.log("BUNDLE_RESULT " + JSON.stringify(result));