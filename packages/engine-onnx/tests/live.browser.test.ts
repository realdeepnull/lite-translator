import { describe, expect, it } from "vitest";
import { createTranslator, type LiveTranslationEvent, type LiveSession } from "@lite-translator/core";
import { createOnnxEngine } from "../src/index.js";

/**
 * Browser integration test for live translation (Step 13).
 * Loads a real OPUS-MT model and exercises createLiveSession() with
 * incremental input — the speech-to-text / chat scenario.
 */

/** Waits for the next `translation` event, with a timeout guard so the test never hangs. */
function waitForTranslation(live: LiveSession, ms = 30000): Promise<LiveTranslationEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("translation event timed out")), ms);
    const off = live.on("translation", (e) => {
      clearTimeout(timer);
      off();
      resolve(e);
    });
  });
}

describe("LiveSession (Browser)", () => {
  it("übersetzt inkrementell 'Hallo wie geht es dir?'", async () => {
    const engine = createOnnxEngine({ device: "wasm" });
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.preload();

    const live = translator.createLiveSession({ debounce: 100 });
    live.update("Hallo wie geht es dir?");
    const result = await waitForTranslation(live);
    expect(result.source).toBe("Hallo wie geht es dir?");
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(/hello|how|you|are/i.test(result.text)).toBe(true);
    live.dispose();
    await translator.dispose();
  }, 600000);

  it("übersetzt einen zweiten Satz inkrementell dazu (Segment-Cache)", async () => {
    const engine = createOnnxEngine({ device: "wasm" });
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.preload();

    const live = translator.createLiveSession({ debounce: 100 });
    live.update("Hallo. Mir geht es gut");
    const first = await waitForTranslation(live);
    expect(first.segments.length).toBe(2);
    expect(first.segments[0]!.complete).toBe(true);
    expect(first.segments[1]!.complete).toBe(false);
    expect(first.segments[0]!.translation.trim().length).toBeGreaterThan(0);

    // Extend to a fully complete second sentence.
    live.update("Hallo. Mir geht es gut. Danke.");
    const second = await waitForTranslation(live);
    // The first sentence "Hallo." was cached — its translation must not change.
    expect(second.segments[0]!.translation).toBe(first.segments[0]!.translation);
    // The second segment was a partial ("Mir geht es gut" → "I'm fine") and is
    // now a complete sentence ("Mir geht es gut." → "I'm fine.") — a different
    // source string, so it is NOT cached and may differ (e.g. trailing period).
    expect(second.segments[1]!.complete).toBe(true);
    expect(second.segments[1]!.translation.trim().length).toBeGreaterThan(0);
    // The new sentence is complete.
    expect(second.segments[2]!.complete).toBe(true);
    live.dispose();
    await translator.dispose();
  }, 600000);

  it("verwirft veraltete Ergebnisse bei schnellem Tippen", async () => {
    const engine = createOnnxEngine({ device: "wasm" });
    const translator = await createTranslator({ from: "de", to: "en", engines: [engine] });
    await translator.preload();

    const live = translator.createLiveSession({ debounce: 80 });
    const events: LiveTranslationEvent[] = [];
    live.on("translation", (e) => events.push(e));
    live.update("H");
    live.update("Ha");
    live.update("Hal");
    live.update("Hallo");
    // Wait for debounce + inference to settle.
    await waitForTranslation(live);
    // Only the latest input should produce a result (discard-by-sequence).
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("Hallo");
    live.dispose();
    await translator.dispose();
  }, 600000);
});