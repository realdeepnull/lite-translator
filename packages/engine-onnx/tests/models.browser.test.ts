import { describe, expect, it } from "vitest";
import { defaultModelIds } from "../src/models.js";

describe("default model registry", () => {
  it("contains the planed additional language pairs", () => {
    expect(defaultModelIds).toMatchObject({
      "de-en": expect.any(String),
      "en-de": expect.any(String),
      "fr-en": expect.any(String),
      "en-fr": expect.any(String),
      "es-en": expect.any(String),
      "en-es": expect.any(String),
      "it-en": expect.any(String),
      "en-it": expect.any(String),
      "nl-en": expect.any(String),
      "en-nl": expect.any(String),
    });
  });
});
