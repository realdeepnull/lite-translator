import { describe, expect, it, vi } from "vitest";
import { TranslationStore } from "../src/store.js";

describe("TranslationStore", () => {
  it("register speichert den Wert und liefert ihn zurück", () => {
    const store = new TranslationStore();
    expect(store.register("title", "Hallo")).toBe("Hallo");
    expect(store.get("title")).toBe("Hallo");
    expect(store.size).toBe(1);
  });

  it("get liefert undefined für nicht-registrierte Keys", () => {
    const store = new TranslationStore();
    expect(store.get("missing")).toBeUndefined();
  });

  it("set überschreibt den Wert für einen Key", () => {
    const store = new TranslationStore();
    store.register("title", "Hallo");
    store.set("title", "Hello");
    expect(store.get("title")).toBe("Hello");
  });

  it("original liefert den ursprünglichen Text auch nach set", () => {
    const store = new TranslationStore();
    store.register("title", "Hallo");
    store.set("title", "Hello");
    expect(store.original("title")).toBe("Hallo");
  });

  it("has gibt true für registrierte Keys zurück", () => {
    const store = new TranslationStore();
    expect(store.has("title")).toBe(false);
    store.register("title", "Hallo");
    expect(store.has("title")).toBe(true);
  });

  it("entries liefert alle [key, value]-Paare in Einfügereihenfolge", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    store.register("b", "2");
    expect([...store.entries()]).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
  });

  it("keys liefert alle registrierten Keys", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    store.register("b", "2");
    expect([...store.keys()]).toEqual(["a", "b"]);
  });

  it("subscribe wird bei register und set benachrichtigt", () => {
    const store = new TranslationStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.register("title", "Hallo");
    expect(listener).toHaveBeenCalledTimes(1);
    store.set("title", "Hello");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stoppt die Benachrichtigung", () => {
    const store = new TranslationStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.register("title", "Hallo");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.set("title", "Hello");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("snapshot liefert eine flache Kopie der Werte", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    store.register("b", "2");
    const snap = store.snapshot();
    expect(snap).toEqual({ a: "1", b: "2" });
    // Mutation des Snapshots darf den Store nicht beeinflussen
    snap.a = "changed";
    expect(store.get("a")).toBe("1");
  });

  it("clear entfernt alle Keys und benachrichtigt Subscriber", () => {
    const store = new TranslationStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.register("a", "1");
    store.register("b", "2");
    store.clear();
    expect(store.size).toBe(0);
    expect(store.get("a")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(3); // register a + register b + clear
  });

  it("mehrfaches subscribe desselben Listeners registriert nur einmal", () => {
    const store = new TranslationStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.subscribe(listener);
    store.register("a", "1");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});