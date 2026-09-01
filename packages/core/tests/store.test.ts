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

  it("setMany setzt mehrere Werte und benachrichtigt genau einmal", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    store.register("b", "2");
    store.register("c", "3");
    const listener = vi.fn();
    store.subscribe(listener);
    store.setMany([
      ["a", "eins"],
      ["b", "zwei"],
      ["c", "drei"],
    ]);
    expect(store.get("a")).toBe("eins");
    expect(store.get("b")).toBe("zwei");
    expect(store.get("c")).toBe("drei");
    expect(listener).toHaveBeenCalledTimes(1); // ein Notify statt N
  });

  it("setMany mit leerem Iterable benachrichtigt nicht", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    const listener = vi.fn();
    store.subscribe(listener);
    store.setMany([]);
    expect(listener).not.toHaveBeenCalled();
    expect(store.get("a")).toBe("1");
  });

  it("setMany lässt den letzten Eintrag bei doppelten Keys gewinnen", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    store.setMany([
      ["a", "eins"],
      ["a", "ONE"],
    ]);
    expect(store.get("a")).toBe("ONE");
  });

  it("setMany invalidiert den gecachten Snapshot", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    const snap1 = store.snapshot();
    store.setMany([["a", "eins"]]);
    const snap2 = store.snapshot();
    expect(snap2).not.toBe(snap1);
    expect(snap2).toEqual({ a: "eins" });
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

  it("snapshot liefert eine flache Kopie der Werte und ist eingefroren", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    store.register("b", "2");
    const snap = store.snapshot();
    expect(snap).toEqual({ a: "1", b: "2" });
    // Der Snapshot ist eingefroren – Mutationen werfen (strict mode) oder tun nichts
    expect(Object.isFrozen(snap)).toBe(true);
    // Der Store bleibt unbeeinflusst
    expect(store.get("a")).toBe("1");
  });

  it("snapshot liefert bei unverändertem Zustand dieselbe Referenz (F1)", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    const snap1 = store.snapshot();
    const snap2 = store.snapshot();
    expect(snap2).toBe(snap1); // gleiche Referenz, kein neues Objekt
  });

  it("snapshot liefert nach register/set/clear eine neue Referenz (F1)", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    const snap1 = store.snapshot();

    store.register("b", "2");
    const snap2 = store.snapshot();
    expect(snap2).not.toBe(snap1);
    expect(snap2).toEqual({ a: "1", b: "2" });

    store.set("a", "x");
    const snap3 = store.snapshot();
    expect(snap3).not.toBe(snap2);
    expect(snap3).toEqual({ a: "x", b: "2" });

    store.clear();
    const snap4 = store.snapshot();
    expect(snap4).not.toBe(snap3);
    expect(snap4).toEqual({});
  });

  it("snapshot nach clear ist eingefroren und leer", () => {
    const store = new TranslationStore();
    store.register("a", "1");
    store.clear();
    const snap = store.snapshot();
    expect(snap).toEqual({});
    expect(Object.isFrozen(snap)).toBe(true);
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