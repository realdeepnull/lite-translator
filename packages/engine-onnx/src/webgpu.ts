/**
 * WebGPU capability detection and device/dtype resolution.
 *
 * The engine defaults to `device: "auto"`, which probes `navigator.gpu` and
 * selects WebGPU when an adapter is available (with fp16 when `shader-f16` is
 * supported), falling back to WASM + bnb4 otherwise.
 */

/** Device selection modes for the ONNX engine. */
export type OnnxDevice = "auto" | "webgpu" | "wasm";

/** Concrete device after resolution (never "auto"). */
export type ResolvedDevice = "webgpu" | "wasm";

/**
 * Dtype options accepted by the engine.
 *
 * - `"fp16"`  — half-precision (WebGPU only, requires `shader-f16`)
 * - `"fp32"`  — full-precision (WebGPU fallback when fp16 is unavailable)
 * - `"bnb4"`  — BitsAndBytes 4-bit quantization (WASM default; avoids the
 *               MatMulNBits regression that affects q8/int8/uint8/q4/q4f16)
 * - `"q4f16"` — 4-bit block weight quantization with fp16 activations
 *               (WebGPU; triggers MatMulNBits bug — use with caution)
 * - `"auto"`  — pick based on the resolved device
 */
export type OnnxDtype = "fp16" | "fp32" | "bnb4" | "q4f16" | "auto";

/** Concrete dtype after resolution (never "auto"). */
export type ResolvedDtype = "fp16" | "fp32" | "bnb4" | "q4f16";

export interface ResolvedCapabilities {
  device: ResolvedDevice;
  dtype: ResolvedDtype;
}

/** Minimal navigator.gpu type to avoid a @webgpu/types dependency. */
interface NavigatorGPU {
  requestAdapter(options?: {
    powerPreference?: "low-power" | "high-performance";
  }): Promise<GPUAdapterLike | null>;
}

interface GPUAdapterLike {
  features: Set<string>;
}

function getNavigatorGpu(): NavigatorGPU | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as unknown as { gpu?: NavigatorGPU }).gpu;
}

/**
 * Checks whether WebGPU is available by probing `navigator.gpu` and
 * requesting an adapter. Returns `false` on any error or absence.
 */
export async function detectWebGpu(): Promise<boolean> {
  const gpu = getNavigatorGpu();
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Checks whether the WebGPU adapter supports `shader-f16`.
 * Returns `false` when WebGPU is unavailable or the feature is missing.
 */
export async function isFp16Supported(): Promise<boolean> {
  const gpu = getNavigatorGpu();
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return false;
    return adapter.features.has("shader-f16");
  } catch {
    return false;
  }
}

/**
 * Default dtype for each resolved device.
 *
 * - WebGPU: `bnb4` (BitsAndBytes 4-bit). fp16 produces empty/garbage output
 *   for short strings (UI labels, single words) — the decoder hallucinates
 *   repetitions and punctuation streams. bnb4 works reliably on both WebGPU
 *   and WASM and is the proven-working quantized dtype on v4's
 *   onnxruntime-web.
 * - WASM:   `bnb4` (the only proven-working quantized dtype on v4's
 *           onnxruntime-web — q8/int8/uint8/q4 all trigger MatMulNBits;
 *           fp32 triggers ShapeInferenceError)
 */
const DEFAULT_DTYPE_FOR_DEVICE: Record<ResolvedDevice, ResolvedDtype> = {
  webgpu: "bnb4",
  wasm: "bnb4",
};

/**
 * Resolves `device` and `dtype` to concrete values.
 *
 * - `device: "wasm"` → `{ device: "wasm", dtype: dtype ?? "bnb4" }`
 * - `device: "webgpu"` → probes WebGPU; throws `Error` if unavailable;
 *   uses `bnb4` unless `dtype` is given explicitly
 * - `device: "auto"` → probes WebGPU; if available → `webgpu`/`bnb4`;
 *   if unavailable → `wasm`/`bnb4`
 *
 * When the caller provides an explicit `dtype` (not "auto"), it is used
 * directly. `q4f16` is accepted but triggers a console warning because it
 * uses MatMulNBits ops affected by a known onnxruntime-web bug.
 */
export async function resolveDeviceDtype(
  device: OnnxDevice,
  dtype?: OnnxDtype,
): Promise<ResolvedCapabilities> {
  const wantsExplicitDtype = dtype !== undefined && dtype !== "auto";

  // --- WASM ---------------------------------------------------------------
  if (device === "wasm") {
    return {
      device: "wasm",
      dtype: wantsExplicitDtype ? (dtype as ResolvedDtype) : DEFAULT_DTYPE_FOR_DEVICE.wasm,
    };
  }

  // --- WebGPU (explicit) --------------------------------------------------
  if (device === "webgpu") {
    const webgpuAvailable = await detectWebGpu();
    if (!webgpuAvailable) {
      throw new Error(
        'WebGPU is not available in this environment. Use device: "auto" or device: "wasm" for automatic fallback.',
      );
    }
    const resolvedDtype = wantsExplicitDtype
      ? (dtype as ResolvedDtype)
      : DEFAULT_DTYPE_FOR_DEVICE.webgpu;
    warnQ4f16(resolvedDtype);
    return { device: "webgpu", dtype: resolvedDtype };
  }

  // --- Auto ---------------------------------------------------------------
  const webgpuAvailable = await detectWebGpu();
  if (webgpuAvailable) {
    const resolvedDtype = wantsExplicitDtype
      ? (dtype as ResolvedDtype)
      : DEFAULT_DTYPE_FOR_DEVICE.webgpu;
    warnQ4f16(resolvedDtype);
    return { device: "webgpu", dtype: resolvedDtype };
  }

  // WebGPU unavailable → WASM fallback
  return {
    device: "wasm",
    dtype: wantsExplicitDtype ? (dtype as ResolvedDtype) : DEFAULT_DTYPE_FOR_DEVICE.wasm,
  };
}

function warnQ4f16(dtype: ResolvedDtype): void {
  if (dtype === "q4f16") {
    console.warn(
      "[lite-translator] dtype 'q4f16' uses MatMulNBits ops affected by a known onnxruntime-web bug " +
        "(https://github.com/huggingface/transformers.js/issues/1635). " +
        "Translation may fail. Consider 'fp16' or 'fp32' instead.",
    );
  }
}