// Every period from one function, in the company's zone, whatever zone the machine runs in; results counted
// in the period they were first reached, from History; approved statements frozen. These run on the Mac's clock and in UTC. Invented.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { leadCells, leads, statements } from "@/lib/db/schema";
import { scoreFacts } from "@/lib/lead-queue";
import { monthStartDate } from "@/lib/leaderboard";
import { addDay, clockIn, dayStartOf, isDay, periodLinks, periodOf, stampIn, weeksIn, workingDaysIn } from "@/lib/periods";
import { approvedIn, firstDataDay } from "@/lib/periods-db";
import { resultInWindow, resultsIn, scoreboard, type LeadFact, type Person } from "@/lib/scoreboard";
import { approve, statementFor } from "@/lib/statements";
import { addUser, createTenant, updateSettings } from "@/lib/tenants";
import { weekStart, weekStartDate } from "@/lib/week";

const Q = "Australia/Eucla"; // UTC+8:45 all year: a zone off the hour by a quarter
const NY = "America/New_York";
const S = { timezone: Q };
const at = (s: string) => new Date(s);
const days = (p: { fromDay: string; toDay: string }) => [p.fromDay, p.toDay];

describe("the company's day", () => {
  it("starts at the zone's midnight, whatever the machine's zone is", () => {
    expect(dayStartOf("2026-11-23", Q).toISOString()).toBe("2026-11-22T15:15:00.000Z");
    expect(dayStartOf("2026-11-23", "UTC").toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(dayStartOf("2026-11-23", NY).toISOString()).toBe("2026-11-23T05:00:00.000Z");
  });

  it("holds across a daylight-saving change", () => {
    expect(dayStartOf("2026-11-01", NY).toISOString()).toBe("2026-11-01T04:00:00.000Z"); // the change day
    expect(dayStartOf("2026-11-02", NY).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(dayStartOf("2026-03-08", NY).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(dayStartOf("2026-03-09", NY).toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(addDay("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDay("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("reads week and month starts in the zone", () => {
    const sundayNightUtc = at("2026-11-22T15:20:00Z"); // already Monday 00:05 in that zone (UTC+8:45)
    expect(weekStart(sundayNightUtc, 1, Q)).toBe("2026-11-23");
    expect(weekStart(sundayNightUtc, 1, "UTC")).toBe("2026-11-16");
    expect(weekStartDate(sundayNightUtc, 1, Q).toISOString()).toBe("2026-11-22T15:15:00.000Z");
    expect(monthStartDate(at("2026-11-30T15:20:00Z"), Q).toISOString()).toBe("2026-11-30T15:15:00.000Z"); // 1 December there
  });

  it("shows a moment as the company reads it", () => {
    expect(clockIn("2026-11-22T15:20:00Z", Q)).toBe("00:05");
    expect(stampIn("2026-11-22T15:20:00Z", Q)).toBe("2026-11-23 00:05");
  });
});

describe("periodOf", () => {
  const now = at("2026-11-25T06:00:00Z"); // a Wednesday
  it("gives each period its days", () => {
    expect(days(periodOf({}, now, S))).toEqual(["2026-11-23", "2026-11-29"]);
    expect(days(periodOf({ p: "today" }, now, S))).toEqual(["2026-11-25", "2026-11-25"]);
    expect(periodOf({ p: "today" }, now, S)).toMatchObject({ key: "today", label: "Today", current: true, weekStart: null });
    // an earlier day, week, month, quarter or year by the arrows (&at=); a later one, or none, is the current
    expect(periodOf({ p: "today", at: "2026-11-23" }, now, S)).toMatchObject({ key: "today", label: "Monday 2026-11-23", fromDay: "2026-11-23", toDay: "2026-11-23", current: false });
    expect(periodOf({ p: "today", at: "2026-11-30" }, now, S)).toMatchObject({ label: "Today", fromDay: "2026-11-25" });
    expect(periodOf({ p: "today", at: "nonsense" }, now, S).fromDay).toBe("2026-11-25");
    expect(periodOf({ at: "2026-11-12" }, now, S)).toMatchObject({ key: "week", label: "Week of 2026-11-09", fromDay: "2026-11-09", weekStart: "2026-11-09" });
    expect(periodOf({ p: "month", at: "2026-09-15" }, now, S)).toMatchObject({ label: "September 2026", fromDay: "2026-09-01", toDay: "2026-09-30" });
    expect(periodOf({ p: "quarter", at: "2026-05-02" }, now, S)).toMatchObject({ label: "Q2 2026", fromDay: "2026-04-01", toDay: "2026-06-30" });
    expect(periodOf({ p: "year", at: "2025-03-01" }, now, S)).toMatchObject({ label: "2025", fromDay: "2025-01-01" });
  });

  it("the filter row's arrows step the same kind of period, and stop at the current one", () => {
    const now = at("2026-11-25T06:00:00Z");
    const L = (q: Parameters<typeof periodOf>[0]) => periodLinks(periodOf(q, now, S), now, Q);
    expect(L({ p: "today" })).toEqual({ prev: "/week?p=today&at=2026-11-24", next: null });
    expect(L({ p: "today", at: "2026-11-24" })).toEqual({ prev: "/week?p=today&at=2026-11-23", next: "/week?p=today" });
    expect(L({})).toEqual({ prev: "/week?at=2026-11-16", next: null });
    expect(L({ p: "last-week" })).toEqual({ prev: "/week?at=2026-11-09", next: "/week" });
    expect(L({ p: "month" })).toEqual({ prev: "/week?p=month&at=2026-10-01", next: null });
    expect(L({ p: "last-month" })).toEqual({ prev: "/week?p=month&at=2026-09-01", next: "/week?p=month" });
    expect(L({ p: "quarter" })).toEqual({ prev: "/week?p=quarter&at=2026-07-01", next: null });
    expect(L({ p: "year", at: "2025-06-01" })).toEqual({ prev: "/week?p=year&at=2024-01-01", next: "/week?p=year" });
    expect(L({ p: "range", from: "2026-11-02", to: "2026-11-04" })).toEqual({ prev: "/week?p=range&from=2026-10-30&to=2026-11-01", next: "/week?p=range&from=2026-11-05&to=2026-11-07" });
    expect(L({ p: "range", from: "2026-11-21", to: "2026-11-25" }).next).toBeNull(); // the next would start after today
    expect(L({ p: "range", from: "2026-11-20", to: "2026-11-24" }).next).toBe("/week?p=range&from=2026-11-25&to=2026-11-29"); // it would hold today
    expect(days(periodOf({ p: "last-week" }, now, S))).toEqual(["2026-11-16", "2026-11-22"]);
    expect(days(periodOf({ p: "month" }, now, S))).toEqual(["2026-11-01", "2026-11-30"]);
    expect(days(periodOf({ p: "last-month" }, now, S))).toEqual(["2026-10-01", "2026-10-31"]);
    expect(days(periodOf({ p: "quarter" }, now, S))).toEqual(["2026-10-01", "2026-12-31"]);
    expect(days(periodOf({ p: "year" }, now, S))).toEqual(["2026-01-01", "2026-12-31"]);
    expect(days(periodOf({ p: "range", from: "2026-11-02", to: "2026-11-04" }, now, S))).toEqual(["2026-11-02", "2026-11-04"]);
  });

  it("takes the company's week start", () => {
    expect(periodOf({}, now, { ...S, updates: { weekStartDay: 0 } }).fromDay).toBe("2026-11-22");
  });

  it("crosses a year", () => {
    const jan = at("2027-01-02T06:00:00Z"); // a Saturday
    expect(days(periodOf({}, jan, S))).toEqual(["2026-12-28", "2027-01-03"]);
    expect(days(periodOf({ p: "last-month" }, jan, S))).toEqual(["2026-12-01", "2026-12-31"]);
    expect(days(periodOf({ p: "quarter" }, jan, S))).toEqual(["2027-01-01", "2027-03-31"]);
    expect(days(periodOf({ p: "year" }, jan, S))).toEqual(["2027-01-01", "2027-12-31"]);
    expect(weeksIn({ fromDay: "2026-12-30", toDay: "2027-01-05" }, 1)).toEqual(["2026-12-28", "2027-01-04"]);
  });

  it("puts an instant in exactly one period at a week, a month and a year boundary", () => {
    for (const edge of ["2026-11-30", "2026-12-01", "2027-01-01"]) {
      const start = dayStartOf(edge, Q);
      for (const key of ["week", "month", "year"]) {
        const a = periodOf({ p: key }, new Date(start.getTime() - 1), S);
        const b = periodOf({ p: key }, start, S);
        if (a.fromDay === b.fromDay) continue;
        expect(a.until.getTime()).toBe(b.from.getTime());
      }
    }
  });

  it("says why a range is refused, and shows this week", () => {
    for (const q of [{ p: "range" }, { p: "range", from: "2026-11-02" }, { p: "range", from: "x", to: "y" }, { p: "range", from: "2026-02-30", to: "2026-03-01" }, { p: "range", from: "2026-11-05", to: "2026-11-04" }, { p: "range", from: "2025-01-01", to: "2026-11-04" }]) {
      const r = periodOf(q, now, S);
      expect(r.key).toBe("week");
      expect(r.problem).not.toBe("");
    }
    expect(periodOf({ p: "nonsense" }, now, S)).toMatchObject({ key: "week", problem: "" });
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
  });

  it("keeps a statement link only for exactly one company week", () => {
    expect(periodOf({}, now, S).weekStart).toBe("2026-11-23");
    expect(periodOf({ p: "last-week" }, now, S).weekStart).toBe("2026-11-16");
    expect(periodOf({ p: "month" }, now, S).weekStart).toBeNull();
    expect(periodOf({ p: "range", from: "2026-11-16", to: "2026-11-22" }, now, S).weekStart).toBe("2026-11-16");
    expect(periodOf({ p: "range", from: "2026-11-17", to: "2026-11-23" }, now, S).weekStart).toBeNull();
  });

  it("counts working days that have started", () => {
    expect(workingDaysIn(periodOf({}, now, S), now, Q)).toBe(3);
    expect(workingDaysIn(periodOf({ p: "last-week" }, now, S), now, Q)).toBe(5);
    expect(workingDaysIn({ fromDay: "2026-12-28", toDay: "2027-01-03" }, at("2027-06-01T00:00:00Z"), Q)).toBe(5);
  });
});

describe("a result counts in the period it was first reached", () => {
  const W1 = { from: at("2026-11-02T00:00:00Z"), until: at("2026-11-09T00:00:00Z") };
  const W2 = { from: W1.until, until: at("2026-11-16T00:00:00Z") };
  const W3 = { from: W2.until, until: at("2026-11-23T00:00:00Z") };
  const base = { resultDate: null, resultSetAt: null, updatedAt: at("2026-11-20T10:00:00Z") };
  const of = (l: Parameters<typeof resultsIn>[0], w: typeof W1) => resultsIn(l, w.from, w.until, "UTC");
  const steps = (...s: [string | null, string][]) => s.map(([value, t]) => ({ value, at: at(t) }));

  it("a Reply in week 1 that becomes a Meeting in week 3 is one of each, in its own week", () => {
    const l = { ...base, result: "Meeting", resultSteps: steps(["Replied", "2026-11-03T10:00:00Z"], ["Meeting", "2026-11-18T10:00:00Z"]) };
    expect(of(l, W1)).toEqual({ replies: 1, meetings: 0, clients: 0 });
    expect(of(l, W2)).toEqual({ replies: 0, meetings: 0, clients: 0 });
    expect(of(l, W3)).toEqual({ replies: 0, meetings: 1, clients: 0 });
  });

  it("a Client reached at once is all three in that week", () => {
    expect(of({ ...base, result: "Client", resultSteps: steps(["Client", "2026-11-04T10:00:00Z"]) }, W1)).toEqual({ replies: 1, meetings: 1, clients: 1 });
  });

  it("keeps what was reached when the answer later goes down a level", () => {
    const l = { ...base, result: "Not interested", resultSteps: steps(["Meeting", "2026-11-03T10:00:00Z"], ["Not interested", "2026-11-18T10:00:00Z"]) };
    expect(of(l, W1)).toEqual({ replies: 1, meetings: 1, clients: 0 });
    expect(of(l, W3)).toEqual({ replies: 0, meetings: 0, clients: 0 });
  });

  it("drops an answer that was undone, and counts it when it comes back", () => {
    const undone = { ...base, result: "Emailed", resultSteps: steps(["Replied", "2026-11-03T10:00:00Z"], ["Emailed", "2026-11-03T10:05:00Z"]) };
    expect(of(undone, W1)).toEqual({ replies: 0, meetings: 0, clients: 0 });
    const back = { ...base, result: "Replied", resultSteps: steps(["Replied", "2026-11-03T10:00:00Z"], [null, "2026-11-03T10:05:00Z"], ["Replied", "2026-11-18T10:00:00Z"]) };
    expect(of(back, W1)).toEqual({ replies: 0, meetings: 0, clients: 0 });
    expect(of(back, W3)).toEqual({ replies: 1, meetings: 0, clients: 0 });
  });

  it("uses a typed Result date for the step that wrote it", () => {
    const l = { ...base, result: "Replied", resultDate: "2026-11-04", resultSetAt: at("2026-11-18T10:00:00Z"), resultSteps: steps(["Replied", "2026-11-18T10:00:00Z"]) };
    expect(of(l, W1).replies).toBe(1);
    expect(of(l, W3).replies).toBe(0);
  });

  it("reads a row with no History on its Result date, as before", () => {
    const l = { ...base, result: "Meeting", resultDate: "2026-11-04" };
    expect(of(l, W1)).toEqual({ replies: 1, meetings: 1, clients: 0 });
    expect(of(l, W2)).toEqual({ replies: 0, meetings: 0, clients: 0 });
  });

  it("never counts a level twice across consecutive periods", () => {
    const l = { ...base, result: "Client", resultSteps: steps(["Replied", "2026-11-03T10:00:00Z"], ["Meeting", "2026-11-10T10:00:00Z"], ["Client", "2026-11-18T10:00:00Z"]) };
    const sum = [W1, W2, W3].map((w) => of(l, w)).reduce((a, b) => ({ replies: a.replies + b.replies, meetings: a.meetings + b.meetings, clients: a.clients + b.clients }));
    expect(sum).toEqual({ replies: 1, meetings: 1, clients: 1 });
  });

  it("reads a calendar-day Result date in the company's zone", () => {
    const l = { resultDate: "2026-11-23", resultSetAt: null, updatedAt: at("2026-11-24T00:00:00Z") };
    const start = dayStartOf("2026-11-23", Q);
    expect(resultInWindow(l, start, new Date(start.getTime() + 86_400_000), Q)).toBe(true);
    expect(resultInWindow(l, new Date(start.getTime() - 7 * 86_400_000), start, Q)).toBe(false);
  });

  it("gives the same sums on the scoreboard", () => {
    const person: Person = { id: "u1", name: "Sam", email: "sam@acme.example", role: "member" };
    const l: LeadFact = { id: "l1", emailStatus: "Email Sent", sentBy: ["Sam"], sentAt: at("2026-11-02T10:00:00Z"), result: "Meeting", resultDate: null, updatedAt: at("2026-11-18T10:00:00Z"), resultSteps: steps(["Replied", "2026-11-03T10:00:00Z"], ["Meeting", "2026-11-18T10:00:00Z"]) };
    const row = (w: typeof W1) => scoreboard([person], [], [l], [], w.from, w.until, 0, w.until, "UTC")[0];
    expect([row(W1).replies, row(W1).meetings, row(W1).sent]).toEqual([1, 0, 1]);
    expect([row(W3).replies, row(W3).meetings, row(W3).sent]).toEqual([0, 1, 0]);
  });
});

describe("with the database", () => {
  async function team() {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    await updateSettings(db, tenant.id, () => ({ timezone: Q }));
    const sam = await addUser(db, tenant.id, "sam@acme.example", "Sam");
    return { db, t: tenant.id, ownerId: owner.id, samId: sam.id };
  }

  it("a statement's week is the company's, whatever the machine's zone", async () => {
    const { db, t, samId } = await team();
    // 00:05 on Monday 11-23 in the company's zone is still Sunday in UTC
    await db.insert(leads).values({ tenantId: t, business: "Edge Shop", emailStatus: "Email Sent", sentBy: ["Sam"], sentAt: at("2026-11-22T15:20:00Z") });
    expect((await statementFor(db, t, samId, "2026-11-23"))?.week.sent).toBe(1);
    expect((await statementFor(db, t, samId, "2026-11-16"))?.week.sent).toBe(0);
  });

  it("feeds History's result steps to the scoreboard", async () => {
    const { db, t } = await team();
    const [l] = await db.insert(leads).values({ tenantId: t, business: "History Shop", emailStatus: "Email Sent", sentBy: ["Sam"], sentAt: at("2026-11-03T10:00:00Z"), result: "Meeting" }).returning();
    for (const [v, when] of [["Replied", "2026-11-04T10:00:00Z"], ["Meeting", "2026-11-18T10:00:00Z"]]) await db.insert(leadCells).values({ tenantId: t, leadId: l.id, column: "result", new: v, actorKind: "person", actorName: "Sam", at: at(when) });
    const { leads: facts } = await scoreFacts(db, t, at("2026-11-01T00:00:00Z"), Q);
    expect(facts[0].resultSteps?.map((s) => s.value)).toEqual(["Replied", "Meeting"]);
  });

  it("an approved statement stays as approved, and is listed with its mark", async () => {
    const { db, t, samId, ownerId } = await team();
    const week = "2026-11-16";
    await db.insert(leads).values({ tenantId: t, business: "Frozen Shop", emailStatus: "Email Sent", sentBy: ["Sam"], sentAt: at("2026-11-17T10:00:00Z") });
    const done = await approve(db, t, samId, week, ownerId);
    await db.insert(leads).values({ tenantId: t, business: "Later Shop", emailStatus: "Email Sent", sentBy: ["Sam"], sentAt: at("2026-11-18T10:00:00Z") });
    expect((await statementFor(db, t, samId, week))?.week).toEqual(done?.week);
    expect((await approvedIn(db, t, [week, "2026-11-23"])).has(`${samId}:${week}`)).toBe(true);
    expect(await db.select().from(statements)).toHaveLength(1);
  });

  it("knows where the data starts", async () => {
    const { db, t } = await team();
    expect(await firstDataDay(db, t, Q)).toBeNull();
    await db.insert(leads).values({ tenantId: t, business: "First Shop", emailStatus: "Email Sent", sentBy: ["Sam"], sentAt: at("2026-11-17T19:00:00Z") });
    expect(await firstDataDay(db, t, Q)).toBe("2026-11-18");
  });
});

describe("the page", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  it("carries the period in the address and says where the data starts", () => {
    const page = read("app/week/page.tsx");
    expect(page).toContain("periodOf({ p: one(sp.p), from: one(sp.from), to: one(sp.to), at: one(sp.at) }, now, who.settings)");
    expect(page).toContain("data starts on");
    expect(read("app/week/period-picker.tsx")).toContain('`/week?p=${k}`');
  });
});
