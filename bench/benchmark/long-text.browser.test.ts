import { describe, it, expect } from "vitest";
import { createTranslator } from "@lite-translator/core";
import { createOnnxEngine } from "../../packages/engine-onnx/src/index.js";

/**
 * Ad-hoc benchmark: long-text translation (multi-paragraph samples).
 *
 * Measures, for each long text individually and for a batch of all three:
 *  - per-text single translation time
 *  - translateBatch() time for the whole set
 *
 * Reports a single line:
 *   BENCH_LONGTEXT <json>
 * Run manually via:
 *   npx vitest run --config bench/benchmark/vitest.config.ts --testNamePattern long-text
 * (or simply: npx vitest run --config bench/benchmark/vitest.config.ts ../../bench/benchmark/long-text.browser.test.ts)
 */

const PAIR = { from: "de", to: "en" } as const;

const sampleTexts = [
  {
    title: "Reisebericht",
    text:
      "Letzten Sommer bin ich mit dem Zug durch die Alpen gereist. " +
      "Die Berge waren noch leicht verschneit und die Täler leuchteten in einem satten Grün. " +
      "In jedem kleinen Dorf gab es eine andere Spezialität zu probieren — von Käse über Frischkäse bis hin zu hausgemachtem Apfelstrudel. " +
      "Besonders im Gedächtnis geblieben ist mir der Sonnenaufgang über dem Mont Blanc, als die ersten Sonnenstrahlen die Gipfel golden färbten.",
  },
  {
    title: "Kurzgeschichte",
    text:
      "Die alte Bibliothek am Marktplatz roch nach Papier und Bohnerwachs. " +
      "Hinter dem Tresen saß Frau Lindqvist, die seit zweiunddreißig Jahren jeden einzelnen Regalstand auswendig kannte. " +
      "Wenn ein Besucher ein Buch suchte, schloss sie kurz die Augen, als riefe sie sich das richtige Regal herbei, und ging dann mit ruhigen Schritten zum richtigen Fach. " +
      "Eines Tages jedoch fehlte ein Band, und niemand wusste, wohin es verschwunden war.",
  },
  {
    title: "Technologie-Kommentar",
    text:
      "Lokale Übersetzungsmodelle werden zunehmend leistungsfähig und können direkt im Browser laufen. " +
      "Das spart Bandbreite, schützt die Privatsphäre der Nutzer und funktioniert auch ohne Netzwerkverbindung. " +
      "Allerdings sind kleine Modelle naturgemäß weniger genau als große Cloud-Modelle — insbesondere bei idiomatischen Ausdrücken, Fachvokabular oder sehr langen Sätzen. " +
      "Für die meisten Alltagstexte reichen sie jedoch völlig aus.",
  },
];

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

describe("long-text benchmark", () => {
  it("misst Einzel- und Batch-Übersetzung langer Texte", async () => {
    const engine = createOnnxEngine({ device: "wasm" });
    const translator = await createTranslator({
      ...PAIR,
      engines: [engine],
      onProgress: (e) => {
        if (e.progress === 1) return;
      },
    });
    await translator.preload();
    const caps = engine.capabilities();

    // ---- individual long texts -------------------------------------------
    const singleMs: Record<string, number> = {};
    let totalSingleMs = 0;
    for (const sample of sampleTexts) {
      const t = performance.now();
      const result = await translator.translate(sample.text);
      const ms = round(performance.now() - t);
      singleMs[sample.title] = ms;
      totalSingleMs += ms;
      expect(result.text.length).toBeGreaterThan(20);
    }

    // ---- batch of all three long texts ------------------------------------
    const batchStart = performance.now();
    const batchResults = await translator.translateBatch(sampleTexts.map((s) => s.text));
    const batchMs = round(performance.now() - batchStart);
    expect(batchResults).toHaveLength(sampleTexts.length);
    expect(batchResults.every((r) => r.text.length > 20)).toBe(true);

    await translator.dispose();

    const report = {
      timestamp: new Date().toISOString(),
      device: caps.device,
      dtype: caps.dtype,
      textLengths: sampleTexts.map((s) => s.text.length),
      singleMs,
      totalSingleMs: round(totalSingleMs),
      batchMs,
      batchSpeedup: round(totalSingleMs / batchMs),
    };
    console.log("BENCH_LONGTEXT " + JSON.stringify(report));
  }, 600_000);
});