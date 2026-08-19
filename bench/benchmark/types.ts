/**
 * Benchmark metrics produced by the de → en benchmark run.
 * Emitted as a single `console.log("BENCH_RESULT " + JSON.stringify(metrics))`
 * line so the Node wrapper script (`run.ts`) can parse it from stdout and
 * write the report files (the browser sandbox cannot write files reliably).
 */
export interface BenchMetrics {
  /** ISO timestamp of the run. */
  timestamp: string;
  /** Browser + OS user-agent string. */
  userAgent: string;
  /** Language pair benchmarked. */
  pair: string;
  /** Cold-start: createTranslator + preload (model download + init), in ms. */
  coldStartMs: number;
  /** Time for the very first translate() call after preload, in ms. */
  firstTranslateMs: number;
  /** Warm translate() durations for N iterations, in ms. */
  warmRunsMs: number[];
  /** Median of warm runs, in ms. */
  warmMedianMs: number;
  /** p95 of warm runs, in ms. */
  warmP95Ms: number;
  /** Mean of warm runs, in ms. */
  warmMeanMs: number;
  /** Number of warm iterations. */
  warmIterations: number;
  /** Time for a single translateBatch() call over the quality-case inputs, in ms. */
  batchTranslateMs: number;
  /** Number of texts passed to the benchmark translateBatch() call. */
  batchInputsCount: number;
  /** Total bytes of model files in Cache Storage (sum of response bodies). */
  modelSizeBytes: number;
  /** Number of model files found in Cache Storage. */
  modelFileCount: number;
}