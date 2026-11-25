import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMNS } from "@/app/leads/lead-table";
import { healthStatus, SHOW_HEALTH_STATUS, siteHealthShort } from "@/lib/site-health-short";
import { clampColumn, COLUMN_WIDTH, columnMenu, columnWidth, fieldOfColumn, isCutCell, tableColumnsOf, withWidth, withWrap } from "@/lib/table-columns";
import { DEFAULT_VIEW, viewOf } from "@/lib/view-prefs";

describe("Site health, short (866)", () => {
  it.each([
    ["https · phone-ready · © 2026 · 1.3s to load (checked 2026-11-09)", "© 2026 · 1.3s to load"],
    ["no https · phone-ready · © 2022 · 0.6s to load (checked 2026-11-23)", "© 2022 · 0.6s to load"],
    ["https · phone-ready · © 2007 · 0.8s to load (checked 2026-11-12)", "© 2007 · 0.8s to load"],
    ["https · phone-ready · 1.1s to load (checked 2026-11-14)", "1.1s to load"],
    ["no https · phone-ready · PDF menu · 1.4s to load (checked 2026-11-11)", "1.4s to load"],
    ["© 2019", "© 2019"],
    ["no website", ""],
    ["site blocks bots (HTTP 403), checked 2026-11-20", ""],
    ["", ""],
    [null, ""],
    [undefined, ""],
  ])("%s", (raw, shown) => expect(siteHealthShort(raw)).toBe(shown));

  it("takes no date for a year", () => expect(siteHealthShort("checked 2026-11-14")).toBe(""));

  it("leaves the blank cells blank for now, and can name them with one switch", () => {
    expect(SHOW_HEALTH_STATUS).toBe(false);
    expect(siteHealthShort("no website", true)).toBe("no website");
    expect(siteHealthShort("site blocks bots (HTTP 403), checked 2026-11-20", true)).toBe("site down");
    expect(siteHealthShort("© 2026 · 1.3s to load", true)).toBe("© 2026 · 1.3s to load");
    expect(healthStatus("something else")).toBe("");
  });

  it("the table shows the short form, from the stored text", () => {
    const col = COLUMNS.find((c) => c.key === "siteHealth")!;
    expect(col.get({ siteHealth: "https · phone-ready · © 2022 · 1.1s to load (checked 2026-11-14)" } as never)).toBe("© 2022 · 1.1s to load");
    expect(col.get({ siteHealth: "no website" } as never)).toBeNull();
  });
});

describe("a column's menu (867)", () => {
  const base = { dir: 0 as 1 | -1 | 0, order: ["A to Z", "Z to A"] as [string, string], canWrap: true, wrap: false, hasWidth: false };
  const actions = (o: Partial<typeof base> & { dir?: 1 | -1 | 0 }) => columnMenu({ ...base, ...o }).map((m) => m.action);

  it("sorts both ways and wraps", () => expect(actions({})).toEqual(["sort-asc", "sort-desc", "wrap"]));
  it("offers Clear sort only while sorted, and marks the direction", () => {
    expect(actions({ dir: 1 })).toEqual(["sort-asc", "sort-desc", "sort-clear", "wrap"]);
    expect(columnMenu({ ...base, dir: -1 }).filter((m) => m.checked).map((m) => m.action)).toEqual(["sort-desc"]);
  });
  it("names the order the column's kind sorts in", () => expect(columnMenu({ ...base, order: ["oldest first", "newest first"] })[1].label).toBe("Sort newest first"));
  it("has no Wrap on a column that cannot wrap", () => expect(actions({ canWrap: false })).toEqual(["sort-asc", "sort-desc"]));
  it("offers Reset width only when one is set", () => expect(actions({ hasWidth: true })).toContain("width-reset"));
  it("shows Wrap as on", () => expect(columnMenu({ ...base, wrap: true }).find((m) => m.action === "wrap")?.checked).toBe(true));
});

describe("wrap and width (867)", () => {
  it("clamps a width", () => {
    expect(clampColumn(10)).toBe(COLUMN_WIDTH.min);
    expect(clampColumn(5000)).toBe(COLUMN_WIDTH.max);
    expect(clampColumn(200.6)).toBe(201);
  });

  it("a wrapped column holds a width, so it can wrap; a set one wins", () => {
    expect(columnWidth(undefined)).toBeNull();
    expect(columnWidth({ wrap: true })).toBe(COLUMN_WIDTH.wrapped);
    expect(columnWidth({ wrap: true, w: 120 })).toBe(120);
  });

  it("sets and clears each without touching the other, and keeps nothing for a default column", () => {
    let c = withWidth({}, "notes", 300);
    c = withWrap(c, "notes", true);
    expect(c).toEqual({ notes: { w: 300, wrap: true } });
    c = withWidth(c, "notes", null);
    expect(c).toEqual({ notes: { wrap: true } });
    c = withWrap(c, "notes", false);
    expect(c).toEqual({});
  });

  it("reads only tidy choices", () => {
    expect(tableColumnsOf({ notes: { w: 5000, wrap: true }, city: { w: 10 }, "bad key": { w: 100 }, x: "no", y: { wrap: "yes" }, z: { w: "wide" } })).toEqual({ notes: { w: COLUMN_WIDTH.max, wrap: true }, city: { w: COLUMN_WIDTH.min } });
    for (const v of [null, [], "x", 3]) expect(tableColumnsOf(v)).toEqual({});
  });

  it("is remembered on the person, beside the drawer's view", () => {
    expect(DEFAULT_VIEW.table_columns).toEqual({});
    expect(viewOf({ table_columns: { notes: { wrap: true } } }).table_columns).toEqual({ notes: { wrap: true } });
    expect(viewOf({}).table_columns).toEqual({});
    const route = readFileSync(path.join(__dirname, "..", "app", "api", "view-prefs", "route.ts"), "utf8");
    expect(route).toContain('"table_columns"');
    expect(readFileSync(path.join(__dirname, "..", "lib", "view-prefs-db.ts"), "utf8")).toContain("table_columns: next.table_columns");
  });

  it("knows a cell the table carries only the start of", () => {
    expect(isCutCell("notes", "x".repeat(160))).toBe(true);
    expect(isCutCell("notes", "x".repeat(159))).toBe(false);
    expect(isCutCell("draftEmail", "x".repeat(120))).toBe(true);
    expect(fieldOfColumn("painPoint")).toBe("pain_point");
    expect(fieldOfColumn("notes")).toBe("notes");
  });
});
