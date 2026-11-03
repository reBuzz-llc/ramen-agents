import { describe, expect, it } from "vitest";
import { choices, filtersFrom, filtersToQuery, industryGroup, matches, NO_FILTERS, placeOf, type Filterable } from "@/lib/lead-filters";

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
