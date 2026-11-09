import { describe, expect, it } from "vitest";
import { readShowEmpty, SHOW_EMPTY_KEY, writeShowEmpty } from "@/lib/drawer-prefs";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };

describe("the drawer's empty fields", () => {
  it("shows them by default, in a fresh browser, with no storage or blocked storage", () => {
    expect(readShowEmpty(memory())).toBe(true);
    expect(readShowEmpty(null)).toBe(true);
    expect(readShowEmpty(broken)).toBe(true);
  });
  it("remembers Hide empty fields, and showing again clears it", () => {
    const s = memory();
    writeShowEmpty(s, false);
    expect(s.m.get(SHOW_EMPTY_KEY)).toBe("1");
    expect(readShowEmpty(s)).toBe(false);
    writeShowEmpty(s, true);
    expect(s.m.has(SHOW_EMPTY_KEY)).toBe(false);
    expect(readShowEmpty(s)).toBe(true);
    expect(() => writeShowEmpty(broken, false)).not.toThrow();
  });
});
