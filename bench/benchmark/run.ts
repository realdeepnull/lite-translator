/**
 * Node wrapper: runs the browser benchmark suite, parses the metrics line,
 * merges it with the bundle-size result, and writes JSON + Markdown reports.
 *
 * Run with:
 *   node --experimental-strip-types bench/benchmark/run.ts
 *
 * Requires `npm run build` to have produced `dist/` in both packages, because
 * the benchmark imports from `@lite-translator/engine-onnx` dist.
 *
 * Output files (gitignored):
 *   bench/report/benchmark-<ISO>.json
 *   bench/report/summary.md   (appended)
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const reportDir = resolve(root, "bench", "report");
const benchConfig = resolve(root, "bench", "benchmark", "vitest.config.ts");

interface BenchMetrics {
  timestamp: string;
  userAgent: string;
  pair: string;
  coldStartMs: number;
  firstTranslateMs: number;
  warmRunsMs: number[];
  warmMedianMs: number;
  warmP95Ms: number;
  warmMeanMs: number;
  warmIterations: number;
  modelSizeBytes: number;
  modelFileCount: number;
}

interface BundleFile {
  path: string;
  rawBytes: number;
  gzipBytes: number;
}
interface BundleResult {
  timestamp: string;
  files: BundleFile[];
  totalRawBytes: number;
  totalGzipBytes: number;
}

interface FullReport {
  benchmark: BenchMetrics;
  bundle: BundleResult;
}

// ---- 1. run browser benchmark -------------------------------------------
console.log("[run] starting browser benchmark suite …");
const vitestBin = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
const benchStdout = execFileSync(
  `"${vitestBin}" run --config "${benchConfig}"`,
  [],
  { encoding: "utf-8", cwd: root, stdio: ["ignore", "pipe", "inherit"], shell: true },
);
const benchLine = extractLine(benchStdout, "BENCH_RESULT");
if (!benchLine) {
  console.error("[run] no BENCH_RESULT line found in vitest output");
  process.exit(1);
}
const bench = JSON.parse(benchLine) as BenchMetrics;

// ---- 2. run bundle-size script ------------------------------------------
console.log("[run] measuring bundle sizes …");
const bundleStdout = execFileSync(
  "node",
  ["--experimental-strip-types", resolve(root, "bench", "benchmark", "bundle-size.ts")],
  { encoding: "utf-8", cwd: root },
);
const bundleLine = extractLine(bundleStdout, "BUNDLE_RESULT");
if (!bundleLine) {
  console.error("[run] no BUNDLE_RESULT line found in bundle-size output");
  process.exit(1);
}
const bundle = JSON.parse(bundleLine) as BundleResult;

// ---- 3. write reports ---------------------------------------------------
mkdirSync(reportDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = resolve(reportDir, `benchmark-${stamp}.json`);
const summaryPath = resolve(reportDir, "summary.md");

const report: FullReport = { benchmark: bench, bundle };
writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");

// Markdown table (append so historical runs accumulate).
const mdRow =
  `| ${bench.timestamp} | ${fmtMs(bench.coldStartMs)} | ${fmtMs(bench.firstTranslateMs)} ` +
  `| ${fmtMs(bench.warmMedianMs)} | ${fmtMs(bench.warmP95Ms)} | ${fmtBytes(bundle.totalGzipBytes)} ` +
  `| ${fmtBytes(bench.modelSizeBytes)} |\n`;

if (!existsSync(summaryPath)) {
  writeFileSync(
    summaryPath,
    "# Benchmark Summary\n\n" +
      "| timestamp | cold start | first | warm median | warm p95 | bundle gzip | model size |\n" +
      "|---|---|---|---|---|---|---|\n",
  );
}
appendFileSync(summaryPath, mdRow);

console.log(`[run] report written: ${jsonPath}`);
console.log(`[run] summary updated: ${summaryPath}`);
console.log("[run] done.");

function extractLine(stdout: string, marker: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf(marker);
    if (idx >= 0) return line.slice(idx + marker.length).trim();
  }
  return undefined;
}

function fmtMs(n: number): string {
  return `${Math.round(n)} ms`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}