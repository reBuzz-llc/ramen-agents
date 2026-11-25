import { describe, expect, it } from "vitest";
import { NO_TAKEN_FILTERS as NONE, readTakenFilters, takenMatches, takenOptions } from "@/lib/taken-filters";
import type { TakenChange, TakenItem } from "@/lib/taken-view";

const change = (over: Partial<TakenChange>): TakenChange => ({ id: 1, field: "Notes", before: "", after: "x", long: false, who: "Mina", person: true, other: false, at: "2026-11-23T08:00:00.000Z", when: "Mon 13:45", today: false, ...over });
const item = (over: Partial<TakenItem>): TakenItem => ({ id: "a", business: "Amerco Construction", where: "Brooklyn, NY", industry: "Construction", kind: "Email", sent: false, at: "2026-11-23T08:00:00.000Z", when: "Mon 13:45", changes: [], ...over });

const ITEMS = [
  item({ id: "a", changes: [change({ today: true })] }),
  item({ id: "b", business: "Beta Bakery", where: "Queens, NY", industry: "Bakery", kind: "WhatsApp", changes: [change({ other: true, who: "Kai" })] }),
  item({ id: "c", business: "Corner Cafe", where: "", industry: "", sent: true, changes: [change({ person: false, who: "Outreach Writer", today: true })] }),
];
const ids = (f: Partial<typeof NONE>) => ITEMS.filter((i) => takenMatches(i, { ...NONE, ...f })).map((i) => i.id);

describe("the Taken page's filters", () => {
  it("shows everything with no filter", () => expect(ids({})).toEqual(["a", "b", "c"]));

  it("searches the business, place and industry, ignoring case", () => {
    expect(ids({ q: "  BETA " })).toEqual(["b"]);
    expect(ids({ q: "brooklyn" })).toEqual(["a"]);
    expect(ids({ q: "bakery" })).toEqual(["b"]);
  });

  it("filters by held or sent, channel, place and industry group", () => {
    expect(ids({ show: "held" })).toEqual(["a", "b"]);
    expect(ids({ show: "sent" })).toEqual(["c"]);
    expect(ids({ channel: "WhatsApp" })).toEqual(["b"]);
    expect(ids({ place: "(not set)" })).toEqual(["c"]);
    expect(ids({ industry: "Food and drink" })).toEqual(["b"]);
    expect(ids({ industry: "Unknown" })).toEqual(["c"]);
  });

  it("counts only a person's change, never an agent's", () => {
    expect(ids({ changes: "today" })).toEqual(["a"]);
    expect(ids({ changes: "other" })).toEqual(["b"]);
    expect(ids({ changes: "none" })).toEqual(["c"]);
  });

  it("combines filters", () => expect(ids({ show: "held", channel: "Email" })).toEqual(["a"]));

  it("counts each choice under the other filters and keeps a chosen value listed", () => {
    const o = takenOptions(ITEMS, { ...NONE, show: "held" });
    expect(o.channel).toEqual([["Email", "Email (1)"], ["WhatsApp", "WhatsApp (1)"]]);
    expect(o.show).toEqual([["held", "Held (2)"], ["sent", "Sent this week (1)"]]);
    expect(o.place.map(([v]) => v)).toEqual(["Brooklyn, NY", "Queens, NY"]);
    expect(takenOptions(ITEMS, { ...NONE, show: "sent", place: "Queens, NY" }).place).toContainEqual(["Queens, NY", "Queens, NY (0)"]);
  });

  it("reads the address, ignoring a value that is not a choice", () => {
    expect(readTakenFilters({ q: "beta", show: "sent", channel: ["WhatsApp", "Email"], changes: "toString", place: "Queens, NY" })).toEqual({ ...NONE, q: "beta", show: "sent", channel: "WhatsApp", place: "Queens, NY" });
    expect(readTakenFilters({ show: "constructor" }).show).toBe("");
    expect(readTakenFilters({ q: "x".repeat(300) }).q).toHaveLength(200);
  });
});
