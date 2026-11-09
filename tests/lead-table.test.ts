import { describe, expect, it } from "vitest";
import {
  arrange,
  COLUMNS,
  moveKey,
  sortRows,
  type TableRow,
} from "@/app/leads/lead-table";

const row = (
  id: string,
  business: string,
  leadScore: number | null,
  city: string | null = null,
): TableRow => ({
  id,
  business,
  website: null,
  city,
  state: null,
  industry: null,
  contactPerson: null,
  contactRole: null,
  package: null,
  leadScore,
  emailStatus: null,
  whatsappStatus: null,
  result: null,
  sentBy: null,
  hasDraft: false,
  hasWhatsapp: false,
  takenBy: null,
  mine: false,
  corrected: false,
  openFlags: 0,
  updatedAt: "2026-11-05T00:00:00.000Z",
});

describe("the Table tab's sort", () => {
  const rows = [
    row("a", "Bakery 10", 70, "Queens"),
    row("b", "bakery 9", null, null),
    row("c", "Café", 90, "Bronx"),
  ];
  it("keeps the board's order with no sort", () =>
    expect(sortRows(rows, null).map((r) => r.id)).toEqual(["a", "b", "c"]));
  it("sorts numbers both ways; an empty cell is at the bottom the first way and at the top the reverse way", () => {
    expect(
      sortRows(rows, { key: "leadScore", dir: 1 }).map((r) => r.id),
    ).toEqual(["a", "c", "b"]);
    expect(
      sortRows(rows, { key: "leadScore", dir: -1 }).map((r) => r.id),
    ).toEqual(["b", "c", "a"]);
  });
  it("sorts names by their numbers and without case", () =>
    expect(
      sortRows(rows, { key: "business", dir: 1 }).map((r) => r.id),
    ).toEqual(["b", "a", "c"]));
  it("sorts a derived column (location from city)", () =>
    expect(
      sortRows(rows, { key: "location", dir: 1 }).map((r) => r.id),
    ).toEqual(["c", "a", "b"]));
  it("has one column per drawer cell, each key once", () =>
    expect(new Set(COLUMNS.map((c) => c.key)).size).toBe(COLUMNS.length));
});

describe("the Table tab's column arrangement", () => {
  const keys = (a: Parameters<typeof arrange>[0]) =>
    arrange(a).map((c) => c.key);
  it("is the board's order with nothing saved", () =>
    expect(keys(null)).toEqual(COLUMNS.map((c) => c.key)));
  it("follows a saved order, drops unknown names and adds new columns at the end", () => {
    const got = keys({ order: ["leadScore", "gone", "website"], hidden: [] });
    expect(got.slice(0, 2)).toEqual(["leadScore", "website"]);
    expect(got).not.toContain("gone");
    expect(got).toHaveLength(COLUMNS.length);
  });
  it("leaves hidden columns out", () =>
    expect(keys({ order: [], hidden: ["notes", "evidence"] })).toHaveLength(
      COLUMNS.length - 2,
    ));
  it("moves a column to the place of the one it is dropped on, either way", () => {
    expect(moveKey(["a", "b", "c", "d"], "d", "b")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
    expect(moveKey(["a", "b", "c", "d"], "a", "c")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(moveKey(["a", "b"], "a", "x")).toEqual(["a", "b"]);
  });
});
