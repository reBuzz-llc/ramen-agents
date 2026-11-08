// The family's reports for /family: the three shapes, masked text only, the newest per kind, and
// the newest 50 kept.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { latestReports, olderThan, parseReport, reportAt, saveReport, unmasked } from "@/lib/family";
import { createTenant } from "@/lib/tenants";

const TICK = {
  kind: "tick",
  today: { drafts_landed: 12, whatsapp_pitches: 4, leads_listed: 6, no_site_share: 33, polished_drafts: 2, contact_roles: { Founder: 3, Owner: 1 } },
  members: [{ name: "Lead Gen", state: "working", line: "searching for bakeries with no website" }],
};

describe("parseReport", () => {
  it("takes the three shapes", () => {
    expect(parseReport(TICK)).toEqual(TICK);
    expect(parseReport({ kind: "morning", lines: ["Drafts landed: 11-07 14, today so far 3"] })).toEqual({ kind: "morning", lines: ["Drafts landed: 11-07 14, today so far 3"] });
    const week = { title: "This week in the family: 2 November to 8 November 2026", summary: "37 leads", url: "https://blog.example/our-week-2026-11-08" };
    expect(parseReport({ kind: "week", week })).toEqual({ kind: "week", week });
  });

  it("refuses what is not masked, and says why", () => {
    expect(() => parseReport({ kind: "morning", lines: ["wrote to owner@bakery.example"] })).toThrow(/lines\[0\] has an email address/);
    expect(() => parseReport({ ...TICK, members: [{ name: "Lead Gen", state: "working", line: "called +1 718 555 0100" }] })).toThrow(/a phone number/);
    expect(() => parseReport({ kind: "morning", lines: ["opened https://bakery.example/menu"] })).toThrow(/a web address/);
    expect(() => parseReport({ kind: "morning", lines: ["opened maplebakery.com"] })).toThrow(/a web address/);
    expect(() => parseReport({ kind: "week", week: { title: "x", url: "http://blog.example/week" } })).toThrow(/week.url/);
    expect(() => parseReport({ kind: "week", week: { title: "x", url: "javascript:alert(1)" } })).toThrow(/week.url/);
    expect(unmasked("12 drafts, 33% with no website")).toBe("");
  });

  it("refuses bad numbers, kinds and sizes", () => {
    expect(() => parseReport({ ...TICK, today: { drafts_landed: -1 } })).toThrow(/drafts_landed/);
    expect(() => parseReport({ ...TICK, today: { no_site_share: 140 } })).toThrow(/percentage/);
    expect(() => parseReport({ kind: "board" })).toThrow(/kind must be/);
    expect(() => parseReport({ kind: "morning", lines: [] })).toThrow(/1 to 60/);
    expect(() => parseReport({ kind: "morning", lines: ["x".repeat(301)] })).toThrow(/longer than 300/);
  });

  it("at: a valid time, never far in the future", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    expect(reportAt("2026-11-08T11:00:00Z", now).toISOString()).toBe("2026-11-08T11:00:00.000Z");
    expect(reportAt("2026-11-09T11:00:00Z", now)).toBe(now);
    expect(reportAt("soon", now)).toBe(now);
    expect(olderThan("2026-11-08T11:20:00Z", 30, now.getTime())).toBe(true);
    expect(olderThan("2026-11-08T11:40:00Z", 30, now.getTime())).toBe(false);
  });
});

describe("saved reports", () => {
  it("the newest of each kind, per company; the newest 50 kept", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const other = await createTenant(db, "Other", "other", { email: "o@other.example", name: "Oz" });
    expect(await latestReports(db, tenant.id)).toEqual({ tick: null, morning: null, week: null });
    const base = Date.parse("2026-11-08T00:00:00Z");
    for (let i = 0; i < 55; i++) await saveReport(db, tenant.id, parseReport({ kind: "morning", lines: [`line ${i}`] }), new Date(base + i * 60_000), "validator");
    await saveReport(db, tenant.id, parseReport(TICK), new Date(base), "validator");
    await saveReport(db, other.tenant.id, parseReport({ kind: "morning", lines: ["theirs"] }), new Date(base + 3_600_000), "validator");
    const l = await latestReports(db, tenant.id);
    expect(l.morning).toMatchObject({ kind: "morning", lines: ["line 54"], at: new Date(base + 54 * 60_000).toISOString() });
    expect(l.tick).toMatchObject({ kind: "tick", today: { drafts_landed: 12 }, members: [{ name: "Lead Gen" }] });
    expect(l.week).toBeNull();
    const { familyReports } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    expect((await db.select().from(familyReports).where(eq(familyReports.kind, "morning"))).filter((r) => r.tenantId === tenant.id)).toHaveLength(50);
  });
});
