import { describe, expect, it } from "vitest";
import { choices, editedMatches, FILTER_KEYS, NO_TOOLS, toolOptions, toolsMatch, filtersFrom, filtersToQuery, hasNoWebsite, industryGroup, matches, NO_FILTERS, placeOf, SITE_FILTERS, siteMatches, type Filterable } from "@/lib/lead-filters";

describe("reading a place", () => {
  it("finds the state in the messy shapes on the board", () => {
    expect(placeOf("Brooklyn, NY, USA")).toEqual({ city: "Brooklyn", state: "NY" });
    expect(placeOf("Queens, NY 11422, USA")).toEqual({ city: "Queens", state: "NY" });
    expect(placeOf("New York, New York, USA")).toEqual({ city: "New York", state: "NY" });
    expect(placeOf("Staten Island, N.Y. 10308")).toEqual({ city: "Staten Island", state: "NY" });
    expect(placeOf("Manhattan, Suite 704, NY")).toEqual({ city: "Manhattan", state: "NY" });
    expect(placeOf("Ridgewood")).toEqual({ city: "Ridgewood", state: "NY" }); // a New York City place on its own
    expect(placeOf("London, UK")).toEqual({ city: "London", state: "UK" });
    expect(placeOf("")).toEqual({ city: "", state: "" });
    // a full address: the city before the state, never the street
    expect(placeOf("31-15 Steinway St, Astoria, NY 11103")).toEqual({ city: "Astoria", state: "NY" });
    expect(placeOf("12 Main St, Suite 4, Hoboken, NJ 07030, USA")).toEqual({ city: "Hoboken", state: "NJ" });
    expect(placeOf("31-15 Steinway St")).toEqual({ city: "", state: "" });
    // the dry run's four rows, and two places named like streets that stay places
    expect(placeOf("276 Fifth Avenue, Suite 704, New York, NY 10001").city).toBe("New York");
    expect(placeOf("3009 Ocean Parkway, Brooklyn, NY 11235, USA").city).toBe("Brooklyn");
    expect(placeOf("36-18 Main St, Suite 602, Flushing, NY 11354").city).toBe("Flushing");
    expect(placeOf("1001 Irving Ave #7, Ridgewood, NY 11385").city).toBe("Ridgewood");
    expect(placeOf("Bay Terrace, NY, USA")).toEqual({ city: "Bay Terrace", state: "NY" });
    // the borough before a spelled-out state stays the city, as before (an import's duplicate check matches on it)
    expect(placeOf("123 Court St, Brooklyn, New York, NY 11201")).toEqual({ city: "Brooklyn", state: "NY" });
    expect(placeOf("Brooklyn, New York, NY 11201")).toEqual({ city: "Brooklyn", state: "NY" });
    expect(placeOf("New York, NY 10001")).toEqual({ city: "New York", state: "NY" });
    expect(placeOf("St. Albans, NY 11412")).toEqual({ city: "St. Albans", state: "NY" });
  });
  it("groups free-text industries", () => {
    expect(industryGroup("Hair Salon")).toBe("Beauty and fitness");
    expect(industryGroup("Full-Service Restaurants")).toBe("Food and drink");
    expect(industryGroup("Child Care Services")).toBe("Health and care"); // "care" is checked before "child"
    expect(industryGroup("")).toBe("Unknown");
    expect(industryGroup("Quantum widgets")).toBe("Other");
  });
});

const row = (o: Partial<Filterable>): Filterable => ({ business: "Biz", contact: "", email: "", whatsapp: "", industry: "", location: "", pkg: "", score: null, created: "", takenBy: null, ...o });

describe("matching", () => {
  const now = new Date("2026-10-14T12:00:00Z").getTime();
  it("applies every filter together", () => {
    const r = row({ business: "Luna Hair", email: "hi@luna.example", industry: "Hair Salon", location: "Brooklyn, NY, USA", pkg: "SMB Website Care Retainer", score: 78, created: "2026-10-10T00:00:00Z" });
    const f = { ...NO_FILTERS, industry: "Beauty and fitness", state: "NY", city: "Brooklyn", score: "70" as const, reach: "email" as const, who: "open" as const, added: "7" as const, q: "luna brooklyn" };
    expect(matches(r, f, now)).toBe(true);
    expect(matches(r, { ...f, score: "85" }, now)).toBe(false);
    expect(matches(r, { ...f, reach: "whatsapp" }, now)).toBe(false); // has an email, so not WhatsApp only
    expect(matches({ ...r, takenBy: { mine: false } }, f, now)).toBe(false);
    expect(matches(r, { ...f, added: "" , q: "pizza" }, now)).toBe(false);
  });
  it("'Not scored yet' keeps only unscored rows; Unknown state matches rows with no place", () => {
    expect(matches(row({}), { ...NO_FILTERS, score: "none", state: "Unknown" })).toBe(true);
    expect(matches(row({ score: 10 }), { ...NO_FILTERS, score: "none" })).toBe(false);
  });
  it("counts choices and round-trips the URL", () => {
    expect(choices([row({ pkg: "A" }), row({ pkg: "B" }), row({ pkg: "A" }), row({})], (r) => r.pkg)).toEqual([
      { value: "A", count: 2 },
      { value: "B", count: 1 },
    ]);
    const f = { ...NO_FILTERS, industry: "Food and drink", score: "70" as const };
    expect(filtersToQuery(f)).toBe("?industry=Food+and+drink&score=70");
    expect(filtersFrom(new URLSearchParams(filtersToQuery(f)))).toEqual(f);
  });
});

describe("the No website quick filters", () => {
  const r = (website: string | null, hasWhatsapp: boolean) => ({ website, hasWhatsapp });
  it("reads an empty or blank website cell as no website", () => {
    expect(hasNoWebsite(null)).toBe(true);
    expect(hasNoWebsite("  ")).toBe(true);
    expect(hasNoWebsite("https://luna.example")).toBe(false);
  });
  it("keeps the no-site leads, and with WhatsApp only those with a number", () => {
    const rows = [r(null, true), r("", false), r("https://a.example", true)];
    expect(rows.filter((x) => siteMatches(x, "none"))).toEqual([r(null, true), r("", false)]);
    expect(rows.filter((x) => siteMatches(x, "none-wa"))).toEqual([r(null, true)]);
    expect(rows.filter((x) => siteMatches(x, ""))).toHaveLength(3);
  });
  it("is one of the filters a link may set", () => {
    expect(FILTER_KEYS).toContain("site");
    expect(SITE_FILTERS.map(([k]) => k)).toEqual(["none", "none-wa"]);
  });
});

describe("the board's Taken by, Last edited and Tools on site filters", () => {
  const NOW = new Date(2026, 10, 23, 15, 0).getTime();
  const ago = (days: number) => new Date(NOW - days * 86400e3).toISOString();

  it("replace Score, Draft email and Contact role in the address", () => {
    for (const k of ["taken", "edited", "tools"]) expect(FILTER_KEYS).toContain(k);
    for (const k of ["score", "draft", "role"]) expect(FILTER_KEYS).not.toContain(k);
  });

  it("Last edited: today, 7 days, 30 days, older", () => {
    expect(editedMatches(new Date(2026, 10, 23, 0, 5).toISOString(), "today", NOW)).toBe(true);
    expect(editedMatches(new Date(2026, 10, 22, 23, 55).toISOString(), "today", NOW)).toBe(false);
    expect(editedMatches(ago(6.9), "7", NOW)).toBe(true);
    expect(editedMatches(ago(7.1), "7", NOW)).toBe(false);
    expect(editedMatches(ago(29), "30", NOW)).toBe(true);
    expect(editedMatches(ago(31), "30", NOW)).toBe(false);
    expect(editedMatches(ago(31), "older", NOW)).toBe(true);
    expect(editedMatches(ago(29), "older", NOW)).toBe(false);
    expect(editedMatches(null, "older", NOW)).toBe(true);
    expect(editedMatches(null, "7", NOW)).toBe(false);
    expect(editedMatches(null, "", NOW)).toBe(true);
  });

  it("Tools on site: any lead holding that tool, or none found", () => {
    expect(toolsMatch(["Wix", "OpenTable"], "OpenTable")).toBe(true);
    expect(toolsMatch(["Wix"], "OpenTable")).toBe(false);
    expect(toolsMatch([], NO_TOOLS)).toBe(true);
    expect(toolsMatch(null, NO_TOOLS)).toBe(true);
    expect(toolsMatch(["Wix"], NO_TOOLS)).toBe(false);
    expect(toolsMatch(null, "")).toBe(true);
  });

  it("lists each tool once with its count, most used first, then the leads with none", () => {
    expect(toolOptions([{ toolsOnSite: ["Wix", "OpenTable"] }, { toolsOnSite: ["Wix", "Wix"] }, { toolsOnSite: [] }, {}])).toEqual([
      ["Wix", "Wix (2)"],
      ["OpenTable", "OpenTable (1)"],
      [NO_TOOLS, `${NO_TOOLS} (2)`],
    ]);
  });
});
