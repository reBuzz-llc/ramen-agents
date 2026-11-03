import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { shifts, tenants } from "@/lib/db/schema";
import { rateHistory, setRate } from "@/lib/member-rates";
import { canSeePay, canSetRate, memberStatement, periodsOf, rateOn, statementLines, type RateRow } from "@/lib/rates";
import { approve, statementFor } from "@/lib/statements";
import { addUser, createTenant } from "@/lib/tenants";
import { eq } from "drizzle-orm";

// Local times, the same clock statementFor's week uses. 2026-10-12 is a Monday.
const at = (day: string, h: number) => new Date(`${day}T${String(h).padStart(2, "0")}:00:00`);
const WEEK = "2026-10-12";
const noOutcomes = { userId: "u", name: "", role: "member", sent: 0, replies: 0, meetings: 0, clients: 0, tasksDone: 0, minutes: 0 };

describe("rates over time", () => {
  const history: RateRow[] = [
    { effectiveFrom: "2026-09-01", hourly: 20, outcomeBonus: 5, currency: "USD" },
    { effectiveFrom: "2026-10-15", hourly: 25, outcomeBonus: 8, currency: "USD" },
  ];

  it("the newest rate on or before a day applies; before any row, the company defaults", () => {
    expect(rateOn(history, {}, "2026-10-14").hourly).toBe(20);
    expect(rateOn(history, {}, "2026-10-15").hourly).toBe(25);
    expect(rateOn(history, { hourly: 12, currency: "EUR" }, "2026-08-01")).toEqual({ hourly: 12, currency: "EUR", from: null });
  });

  it("a mid-week change splits the week, and each hour is paid at the rate of the day it was worked", () => {
    expect(periodsOf(history, {}, WEEK).map((p) => [p.from, p.to])).toEqual([["2026-10-12", "2026-10-15"], ["2026-10-15", "2026-10-19"]]);
    const worked = [
      { startedAt: at("2026-10-12", 9), endedAt: at("2026-10-12", 13), projectId: null }, // Mon 4 h at 20
      { startedAt: at("2026-10-16", 9), endedAt: at("2026-10-16", 11), projectId: null }, // Fri 2 h at 25
    ];
    const lines = statementLines(worked, history, {}, WEEK, at("2026-10-19", 0));
    expect(lines).toEqual([
      { project: "General", from: "2026-10-12", to: "2026-10-14", hours: 4, hourly: 20, base: 80 },
      { project: "General", from: "2026-10-15", to: "2026-10-18", hours: 2, hourly: 25, base: 50 },
    ]);
    const s = memberStatement({ ...noOutcomes, replies: 2, meetings: 1 }, lines, history, {}, WEEK);
    expect(s).toMatchObject({ hours: 6, base: 130, outcomes: 3, outcomeBonus: 8, bonus: 24, total: 154, missing: [] });
  });

  it("projects get their own lines, named from the project list; no project is General", () => {
    const byProject = (xs: { projectId: string | null; startedAt: Date; endedAt: Date | null }[]) => {
      const m = new Map<string | null, number>();
      for (const x of xs) m.set(x.projectId, (m.get(x.projectId) ?? 0) + ((x.endedAt as Date).getTime() - x.startedAt.getTime()) / 60000);
      return m;
    };
    const worked = [
      { startedAt: at("2026-10-13", 9), endedAt: at("2026-10-13", 12), projectId: "p1" },
      { startedAt: at("2026-10-13", 13), endedAt: at("2026-10-13", 14), projectId: null },
    ];
    const lines = statementLines(worked, history, {}, WEEK, at("2026-10-19", 0), byProject, new Map([["p1", "Acme Bakery site"]]));
    expect(lines.map((l) => [l.project, l.hours, l.base])).toEqual([["Acme Bakery site", 3, 60], ["General", 1, 20]]);
  });

  it("an unset rate is never guessed: the figure stays empty and is named", () => {
    const lines = statementLines([{ startedAt: at("2026-10-13", 9), endedAt: at("2026-10-13", 10), projectId: null }], [], {}, WEEK, at("2026-10-19", 0));
    const s = memberStatement(noOutcomes, lines, [], {}, WEEK);
    expect(s.base).toBeNull();
    expect(s.total).toBeNull();
    expect(s.missing).toEqual(["hourly rate", "outcome bonus"]);
  });
});

describe("who sees and sets pay", () => {
  const owner = { id: "o", role: "owner" };
  const mgr = { id: "m", role: "manager" };
  const mgr2 = { id: "m2", role: "manager" };
  const ann = { id: "a", role: "member" };
  const bo = { id: "b", role: "member" };
  it("the owner sets anyone's; a manager a member's, never their own, a manager's or the owner's; members nobody's", () => {
    expect([canSetRate(owner, mgr), canSetRate(owner, owner), canSetRate(mgr, ann)]).toEqual([true, true, true]);
    expect([canSetRate(mgr, mgr), canSetRate(mgr, mgr2), canSetRate(mgr, owner), canSetRate(ann, ann), canSetRate(ann, bo)]).toEqual([false, false, false, false, false]);
  });
  it("teammates never see each other's pay", () => {
    expect([canSeePay(ann, ann), canSeePay(owner, ann), canSeePay(mgr, ann)]).toEqual([true, true, true]);
    expect([canSeePay(ann, bo), canSeePay(ann, mgr), canSeePay(mgr, mgr2), canSeePay(mgr, owner)]).toEqual([false, false, false, false]);
  });
});

describe("statements from the database", () => {
  it("two members on different rates, one changed mid-week; an approved statement does not move", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    await db.update(tenants).set({ settings: { rates: { hourly: 15, outcomeBonus: 4, currency: "USD" } } }).where(eq(tenants.id, tenant.id));
    const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
    const bo = await addUser(db, tenant.id, "bo@acme.example", "Bo");
    await setRate(db, tenant.id, ann.id, "2026-10-01", { hourly: 20, outcomeBonus: 5, currency: "USD" }, owner.id);
    await setRate(db, tenant.id, ann.id, "2026-10-15", { hourly: 25, outcomeBonus: 5, currency: "USD" }, owner.id); // Thursday
    await setRate(db, tenant.id, ann.id, "2026-10-15", { hourly: 26, outcomeBonus: 5, currency: "USD" }, owner.id); // same-day fix replaces
    expect((await rateHistory(db, tenant.id, ann.id)).map((r) => r.hourly)).toEqual([20, 26]);
    await db.insert(shifts).values([
      { tenantId: tenant.id, userId: ann.id, startedAt: at("2026-10-13", 9), endedAt: at("2026-10-13", 17) }, // Tue 8 h at 20
      { tenantId: tenant.id, userId: ann.id, startedAt: at("2026-10-16", 9), endedAt: at("2026-10-16", 13) }, // Fri 4 h at 26
      { tenantId: tenant.id, userId: bo.id, startedAt: at("2026-10-14", 10), endedAt: at("2026-10-14", 16) }, // Wed 6 h, defaults
    ]);
    const a = await statementFor(db, tenant.id, ann.id, WEEK);
    const b = await statementFor(db, tenant.id, bo.id, WEEK);
    expect(a?.statement).toMatchObject({ hours: 12, base: 264, currency: "USD" }); // 8 x 20 + 4 x 26
    expect(a?.statement.lines?.map((l) => [l.from, l.hourly, l.base])).toEqual([["2026-10-12", 20, 160], ["2026-10-15", 26, 104]]);
    expect(b?.statement).toMatchObject({ hours: 6, base: 90, outcomeBonus: 4 }); // Bo has no rate of his own: 6 x 15

    await approve(db, tenant.id, ann.id, WEEK, owner.id);
    await setRate(db, tenant.id, ann.id, "2026-10-12", { hourly: 99, outcomeBonus: 5, currency: "USD" }, owner.id); // back-dated
    const frozen = await statementFor(db, tenant.id, ann.id, WEEK);
    expect(frozen?.approved?.by).toBe("Olu");
    expect(frozen?.statement.base).toBe(264);
  });
});

describe("statement lines by project", () => {
  it("hours on a project and on General each get a line, named from the project list", async () => {
    const { addProject } = await import("@/lib/projects");
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
    const added = await addProject(db, tenant.id, "Acme Bakery site", "Acme Bakery");
    if (!added.ok) throw new Error(added.error);
    const site = added.project;
    await setRate(db, tenant.id, ann.id, "2026-10-01", { hourly: 30, outcomeBonus: 5, currency: "USD" }, owner.id);
    await db.insert(shifts).values([
      { tenantId: tenant.id, userId: ann.id, startedAt: at("2026-10-13", 9), endedAt: at("2026-10-13", 12), projectId: site.id },
      { tenantId: tenant.id, userId: ann.id, startedAt: at("2026-10-13", 13), endedAt: at("2026-10-13", 14) },
    ]);
    const s = await statementFor(db, tenant.id, ann.id, WEEK);
    expect(s?.statement.lines?.map((l) => [l.project, l.hours, l.base]).sort()).toEqual([["Acme Bakery site", 3, 90], ["General", 1, 30]]);
    expect(s?.statement.base).toBe(120);
  });
});
