// A member who forgot to clock out yesterday could not clock in today (the Clock, showing today's shifts, said she
// was not clocked in): the Clock asks when the forgotten shift ended and closes it then.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { memoryDb } from "@/lib/db";
import { addUser, clockIn, closeForgotten, createTenant, forgottenShift, shiftsSince } from "@/lib/tenants";

const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const H = 3600e3;

async function yesterdayLeftOpen() {
  const db = await memoryDb();
  const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "O" });
  const sam = await addUser(db, tenant.id, "sam@acme.example", "Sam", "member");
  const today = new Date("2026-11-19T00:00:00");
  const started = new Date(today.getTime() - 8 * H + 14 * 60e3); // yesterday 16:14
  expect((await clockIn(db, tenant.id, sam.id, started)).ok).toBe(true);
  return { db, tenantId: tenant.id, sam, today, started, now: new Date(today.getTime() + 13.6 * H) };
}

describe("a shift left open from yesterday", () => {
  it("blocks Clock in (as before) and is found as forgotten; today's open shift is not", async () => {
    const { db, tenantId, sam, today, now } = await yesterdayLeftOpen();
    expect(await clockIn(db, tenantId, sam.id, now)).toEqual({ ok: false, reason: "already clocked in" });
    expect(await shiftsSince(db, tenantId, sam.id, today)).toEqual([]); // why the Clock said "not clocked in"
    const f = await forgottenShift(db, tenantId, sam.id, today);
    expect(f?.endedAt).toBeNull();
    expect(await forgottenShift(db, tenantId, sam.id, new Date(today.getTime() - 24 * H))).toBeNull();
  });

  it("closes at the time the person stopped; then Clock in works and nothing is forgotten", async () => {
    const { db, tenantId, sam, today, started, now } = await yesterdayLeftOpen();
    const f = (await forgottenShift(db, tenantId, sam.id, today))!;
    const stop = new Date(started.getTime() + 2 * H);
    const r = await closeForgotten(db, tenantId, sam.id, f.id, stop, "  calls  ".trim(), now);
    expect(r.ok).toBe(true);
    expect(r.ok && r.shift.endedAt?.getTime()).toBe(stop.getTime());
    expect(r.ok && r.shift.note).toBe("calls");
    expect(await forgottenShift(db, tenantId, sam.id, today)).toBeNull();
    expect((await clockIn(db, tenantId, sam.id, now)).ok).toBe(true);
  });

  it("refuses a time before the start, a time to come, someone else's shift, and a closed one", async () => {
    const { db, tenantId, sam, today, started, now } = await yesterdayLeftOpen();
    const f = (await forgottenShift(db, tenantId, sam.id, today))!;
    expect(await closeForgotten(db, tenantId, sam.id, f.id, new Date(started.getTime() - 60e3), "", now)).toEqual({ ok: false, reason: "The time you stopped must be after the shift started." });
    expect(await closeForgotten(db, tenantId, sam.id, f.id, new Date(now.getTime() + 60e3), "", now)).toEqual({ ok: false, reason: "That time has not come yet. Give the time you stopped." });
    expect(await closeForgotten(db, tenantId, sam.id, f.id, new Date("x"), "", now)).toEqual({ ok: false, reason: "Give the date and time you stopped." });
    const ana = await addUser(db, tenantId, "ana@acme.example", "Ana", "manager");
    expect(await closeForgotten(db, tenantId, ana.id, f.id, new Date(started.getTime() + H), "", now)).toEqual({ ok: false, reason: "That shift is not open." });
    expect((await closeForgotten(db, tenantId, sam.id, f.id, new Date(started.getTime() + H), "", now)).ok).toBe(true);
    expect(await closeForgotten(db, tenantId, sam.id, f.id, new Date(started.getTime() + 2 * H), "", now)).toEqual({ ok: false, reason: "That shift is not open." });
  });

  it("the route answers it and the Clock shows the panel in place of Clock in", () => {
    const r = src("app/api/clock/route.ts");
    expect(r).toContain('body.action === "closeForgotten"');
    expect(src("lib/clock-day.ts")).toContain("forgottenShift(d, tenantId, userId, since)");
    expect(r).toContain('guard("clock.own")');
    const v = src("app/clock/clock-view.tsx");
    expect(v).toContain(") : dayData.forgotten ? (");
    expect(v.indexOf(") : dayData.forgotten ? (")).toBeLessThan(v.indexOf("Not clocked in"));
    expect(v).toContain('action: "closeForgotten"');
    expect(v).toContain("You are still clocked in since");
  });
});
