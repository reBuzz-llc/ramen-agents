import { describe, expect, it } from "vitest";
import { navOf } from "@/lib/lead-nav";

describe("the lead panel's arrows", () => {
  const list = ["a", "b", "c"];
  it("gives the row above and below", () => expect(navOf(list, "b")).toEqual({ at: 2, total: 3, prev: "a", next: "c" }));
  it("has nothing above the first row", () => expect(navOf(list, "a")).toEqual({ at: 1, total: 3, prev: null, next: "b" }));
  it("has nothing below the last row", () => expect(navOf(list, "c")).toEqual({ at: 3, total: 3, prev: "b", next: null }));
  it("has no place for a lead outside the list", () => expect(navOf(list, "z")).toBeNull());
  it("handles a list of one", () => expect(navOf(["a"], "a")).toEqual({ at: 1, total: 1, prev: null, next: null }));
});
