import { describe, expect, it, vi } from "vitest";
import { createEmitter } from "../src/emitter.js";

describe("createEmitter", () => {
  it("on/off/once/emit/clear", () => {
    const e = createEmitter<{ a: [v: number]; b: [] }>();
    const fn = vi.fn();
    const off = e.on("a", fn);
    e.emit("a", 1);
    expect(fn).toHaveBeenCalledWith(1);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    e.emit("a", 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("once fires a single time then unsubscribes", () => {
    const e = createEmitter<{ x: [v: string] }>();
    const fn = vi.fn();
    e.once("x", fn);
    e.emit("x", "a");
    e.emit("x", "b");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("emit calls listeners in subscription order", () => {
    const e = createEmitter<{ e: [] }>();
    const order: string[] = [];
    e.on("e", () => order.push("first"));
    e.on("e", () => order.push("second"));
    e.emit("e");
    expect(order).toEqual(["first", "second"]);
  });

  it("off removes only one occurrence of a duplicate listener", () => {
    const e = createEmitter<{ e: [] }>();
    const fn = vi.fn();
    e.on("e", fn);
    e.on("e", fn);
    e.emit("e");
    expect(fn).toHaveBeenCalledTimes(2);
    e.off("e", fn);
    e.emit("e");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("clear(event) removes only that event's listeners", () => {
    const e = createEmitter<{ a: []; b: [] }>();
    const a = vi.fn();
    const b = vi.fn();
    e.on("a", a);
    e.on("b", b);
    e.clear("a");
    e.emit("a");
    e.emit("b");
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("clear() without argument removes all listeners", () => {
    const e = createEmitter<{ a: []; b: [] }>();
    const a = vi.fn();
    const b = vi.fn();
    e.on("a", a);
    e.on("b", b);
    e.clear();
    e.emit("a");
    e.emit("b");
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("emit with no listeners is a no-op", () => {
    const e = createEmitter<{ e: [v: number] }>();
    expect(() => e.emit("e", 1)).not.toThrow();
  });

  it("listeners can unsubscribe during emit (snapshot iteration)", () => {
    const e = createEmitter<{ e: [] }>();
    const order: string[] = [];
    let off2: () => void = () => {};
    e.on("e", () => order.push("first"));
    off2 = e.on("e", () => {
      order.push("second");
      off2();
    });
    e.on("e", () => order.push("third"));
    e.emit("e");
    expect(order).toEqual(["first", "second", "third"]);
    e.emit("e");
    expect(order).toEqual(["first", "second", "third", "first", "third"]);
  });
});