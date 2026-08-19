import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTranslator, type Translator } from "@lite-translator/core";
import { createOnnxEngine } from "../../packages/engine-onnx/src/index.js";
import { hasEnglishNegation, hasGermanNegation, qualityCases } from "./cases.js";

/**
 * Quality suite for de → en translation.
 *
 * Loads the real ONNX engine once (beforeAll) and reuses the downloaded model
 * across all cases to avoid repeated downloads. Each case runs as its own
 * `it()` so failures are reported per category/id.
 *
 * Two checks are applied:
 *  1. Assertion: every regex in `expects` must match the output (case-insensitive).
 *  2. Critical failure: when `critical` is set, negation/numbers/length are
 *     verified so that regressions (flipped negation, dropped numbers, empty or
 *     reversed output) fail the test.
 *
 * This suite is a CI gate: a regression in any case fails CI.
 */

const PAIR = { from: "de", to: "en" } as const;

let translator: Translator;

describe("de → en quality", () => {
  // Download the model once for all cases. The long timeout accounts for a cold
  // HF Hub download under CI.
  beforeAll(async () => {
    translator = await createTranslator({
      ...PAIR,
      engines: [createOnnxEngine()],
    });
    await translator.preload();
  }, 600_000);

  afterAll(async () => {
    await translator?.dispose();
  });

  for (const c of qualityCases) {
    it(`${c.category}/${c.id}: "${truncate(c.input)}"`, async () => {
      const result = await translator.translate(c.input);
      const out = result.text;
      const lower = out.toLowerCase();

      // 1) content assertions
      for (const re of c.expects) {
        const reCi = new RegExp(re.source, re.flags.includes("i") ? re.flags : `${re.flags}i`);
        expect(
          reCi.test(out),
          `expected output to match ${reCi} (got "${truncate(out)}")`,
        ).toBe(true);
      }

      // 2) critical-failure checks
      if (c.critical) {
        // empty / reversed
        expect(out.trim().length, "output must not be empty").toBeGreaterThan(0);
        if (c.critical.minLength !== undefined) {
          expect(
            out.length,
            `output length ${out.length} < minLength ${c.critical.minLength}`,
          ).toBeGreaterThanOrEqual(c.critical.minLength);
        }
        // negation preserved
        if (c.critical.preserveNegation) {
          const srcNeg = hasGermanNegation(c.input);
          if (srcNeg) {
            expect(
              hasEnglishNegation(out),
              `source has negation but output lost it: "${truncate(out)}"`,
            ).toBe(true);
          }
        }
        // numbers preserved
        if (c.critical.preserveNumbers) {
          for (const num of c.critical.preserveNumbers) {
            expect(
              lower.includes(num.toLowerCase()),
              `output lost number "${num}": "${truncate(out)}"`,
            ).toBe(true);
          }
        }
      }
    }, 30_000);
  }
});

function truncate(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}