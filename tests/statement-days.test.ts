import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { shiftNotes, shifts } from "@/lib/db/schema";
import { textPdf } from "@/lib/pdf";
import { daysOf } from "@/lib/rates";
import { approve, statementFor } from "@/lib/statements";
import { addUser, createTenant } from "@/lib/tenants";

const at = (day: string, h: number, m = 0) => new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
const WEEK = "2026-10-12"; // a Monday

describe("the statement day by day", () => {
  it("each day lists its shifts, and each shift its notes, oldest first", () => {
    const worked = [
      { id: "s2", startedAt: at("2026-10-13", 13), endedAt: at("2026-10-13", 15), projectId: "p1" },
      { id: "s1", startedAt: at("2026-10-13", 9), endedAt: at("2026-10-13", 12), projectId: null },
      { id: "s3", startedAt: at("2026-10-15", 10), endedAt: null, projectId: null },
    ];
    const notes = [
      { shiftId: "s1", at: at("2026-10-13", 11), text: "on a call with a client" },
      { shiftId: "s1", at: at("2026-10-13", 9, 5), text: "switched to the Brooklyn list" },
      { shiftId: "s2", at: at("2026-10-13", 13, 30), text: "redoing the bakery draft" },
    ];
    const days = daysOf(worked, notes, at("2026-10-15", 11), [{ id: "p1", name: "Acme Bakery site" }]);
    expect(days.map((d) => [d.day, d.minutes])).toEqual([["2026-10-13", 300], ["2026-10-15", 60]]);
    expect(days[0].shifts.map((s) => [s.project, s.minutes])).toEqual([["General", 180], ["Acme Bakery site", 120]]);
    expect(days[0].shifts[0].notes.map((n) => n.text)).toEqual(["switched to the Brooklyn list", "on a call with a client"]);
    expect(days[1].shifts[0]).toMatchObject({ end: null, minutes: 60, notes: [] }); // an open shift runs to now
  });

  it("statementFor reads the week's notes with the shifts; an approved statement keeps them as they were", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
    const [s1] = await db.insert(shifts).values({ tenantId: tenant.id, userId: ann.id, startedAt: at("2026-10-13", 9), endedAt: at("2026-10-13", 12) }).returning();
    const [old] = await db.insert(shifts).values({ tenantId: tenant.id, userId: ann.id, startedAt: at("2026-10-05", 9), endedAt: at("2026-10-05", 10) }).returning();
    await db.insert(shiftNotes).values([
      { tenantId: tenant.id, userId: ann.id, shiftId: s1.id, at: at("2026-10-13", 10), text: "listing Queens bakeries" },
      { tenantId: tenant.id, userId: ann.id, shiftId: old.id, at: at("2026-10-05", 9, 30), text: "last week" },
    ]);
    const s = await statementFor(db, tenant.id, ann.id, WEEK);
    expect(s?.days.map((d) => d.day)).toEqual(["2026-10-13"]);
    expect(s?.days[0].shifts[0].notes.map((n) => n.text)).toEqual(["listing Queens bakeries"]);
    await approve(db, tenant.id, ann.id, WEEK, owner.id);
    await db.insert(shiftNotes).values({ tenantId: tenant.id, userId: ann.id, shiftId: s1.id, at: at("2026-10-13", 11), text: "added after approval" });
    const frozen = await statementFor(db, tenant.id, ann.id, WEEK);
    expect(frozen?.days[0].shifts[0].notes.map((n) => n.text)).toEqual(["listing Queens bakeries"]);
  });

  it("a long statement runs onto a second page", () => {
    const one = Buffer.from(textPdf([{ text: "short" }])).toString("latin1");
    const long = Buffer.from(textPdf(Array.from({ length: 80 }, (_, i) => ({ text: `line ${i}` })))).toString("latin1");
    expect(one.match(/\/Type \/Page /g)).toHaveLength(1);
    expect(long.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(long).toContain("/Count 2");
  });
});

describe("cadence, rounding and the week's start day on statements", () => {
  it("weekStart takes the company's start day; Monday when unset", async () => {
    const { weekStart, startDayOf } = await import("@/lib/week");
    const thu = new Date("2026-10-15T10:00:00");
    expect(weekStart(thu)).toBe("2026-10-12"); // Monday
    expect(weekStart(thu, 0)).toBe("2026-10-11"); // Sunday
    expect(weekStart(thu, 4)).toBe("2026-10-15"); // Thursday: today
    expect(weekStart(thu, 5)).toBe("2026-10-09"); // Friday: last week's
    expect([startDayOf({}), startDayOf({ updates: { weekStartDay: 0 } }), startDayOf({ updates: { weekStartDay: 9 } })]).toEqual([1, 0, 1]);
  });

  it("a shift shows how many of its update windows had a note; no cadence, no count", () => {
    const shift = { id: "s1", startedAt: at("2026-10-13", 9), endedAt: at("2026-10-13", 12), projectId: "p1" };
    const notes = [{ shiftId: "s1", at: at("2026-10-13", 9, 20), text: "a" }, { shiftId: "s1", at: at("2026-10-13", 11, 10), text: "b" }];
    const hourly = [{ id: "p1", name: "Acme Bakery site", cadenceHistory: [{ from: "2026-01-01T00:00:00.000Z", minutes: 60 }] }];
    expect(daysOf([shift], notes, at("2026-10-14", 0), hourly)[0].shifts[0].updates).toEqual({ expected: 3, met: 2 });
    expect(daysOf([shift], notes, at("2026-10-14", 0), [{ id: "p1", name: "Acme Bakery site", cadenceHistory: [] }])[0].shifts[0].updates).toBeUndefined();
  });

  it("rounding to 15 minutes changes paid and total minutes, never the shift's own times", () => {
    const shift = { id: "s1", startedAt: at("2026-10-13", 9, 7), endedAt: at("2026-10-13", 11, 52), projectId: null };
    const [day] = daysOf([shift], [], at("2026-10-14", 0), [], {}, 15);
    expect(day.minutes).toBe(180); // 09:00-12:00
    expect(day.shifts[0].start).toBe(shift.startedAt.toISOString());
    expect(daysOf([shift], [], at("2026-10-14", 0))[0].minutes).toBe(165); // raw: 2 h 45
  });

  it("statementFor rounds with the company setting and freezes the update counts on approve", async () => {
    const { setRate } = await import("@/lib/member-rates");
    const { tenants, projects } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    await db.update(tenants).set({ settings: { updates: { rounding: 15, weekStartDay: 1 } } }).where(eq(tenants.id, tenant.id));
    const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
    await setRate(db, tenant.id, ann.id, "2026-10-01", { hourly: 20, outcomeBonus: 5, currency: "USD" }, owner.id);
    const [p] = await db.insert(projects).values({ tenantId: tenant.id, name: "Acme Bakery site", cadenceHistory: [{ from: "2026-01-01T00:00:00.000Z", minutes: 60 }] }).returning();
    const [s1] = await db.insert(shifts).values({ tenantId: tenant.id, userId: ann.id, projectId: p.id, startedAt: at("2026-10-13", 9, 7), endedAt: at("2026-10-13", 11, 52) }).returning();
    await db.insert(shiftNotes).values({ tenantId: tenant.id, userId: ann.id, shiftId: s1.id, at: at("2026-10-13", 9, 30), text: "listing Queens bakeries" });
    const s = await statementFor(db, tenant.id, ann.id, WEEK);
    expect(s?.statement.hours).toBe(3);
    expect(s?.statement.base).toBe(60);
    expect(s?.week.minutes).toBe(180);
    expect(s?.days[0].shifts[0].updates).toEqual({ expected: 2, met: 1 });
    await approve(db, tenant.id, ann.id, WEEK, owner.id);
    await db.insert(shiftNotes).values({ tenantId: tenant.id, userId: ann.id, shiftId: s1.id, at: at("2026-10-13", 10, 30), text: "late" });
    expect((await statementFor(db, tenant.id, ann.id, WEEK))?.days[0].shifts[0].updates).toEqual({ expected: 2, met: 1 });
  });
});
