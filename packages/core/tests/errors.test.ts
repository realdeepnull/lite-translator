import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  TranslatorError,
  formatTranslatorError,
} from "../src/index.js";

describe("formatTranslatorError", () => {
  it("formatiert einen TranslatorError mit Code und Message", () => {
    const err = new TranslatorError(ERROR_CODES.MODEL_LOAD_FAILED, "boom");
    expect(formatTranslatorError(err)).toBe("Fehler: MODEL_LOAD_FAILED: boom");
  });

  it("formatiert einen normalen Error über message", () => {
    expect(formatTranslatorError(new Error("fail"))).toBe("Fehler: fail");
  });

  it("formatiert einen String über String(err)", () => {
    expect(formatTranslatorError("oops")).toBe("Fehler: oops");
  });

  it("formatiert ein Objekt mit message-Eigenschaft", () => {
    expect(formatTranslatorError({ message: "x" })).toBe("Fehler: x");
  });

  it("formatiert null/undefined ohne Absturz", () => {
    expect(formatTranslatorError(null)).toBe("Fehler: null");
    expect(formatTranslatorError(undefined)).toBe("Fehler: undefined");
  });

  it("formatiert einen Error ohne message über String(err)", () => {
    const obj = { toString: () => "custom" };
    expect(formatTranslatorError(obj)).toBe("Fehler: custom");
  });
});