import { describe, expect, it } from "vitest";
import { cadenceFor, entryAt, liveUpdate, roundShift, updateWindows, withChange, type CadenceEntry } from "@/lib/cadence";

const at = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00Z`);
const hourly = () => 60;

describe("update windows", () => {
  it("counts ended windows and the ones with a note; a running window is not missed yet", () => {
    const shift = { startedAt: at("09:00"), endedAt: at("13:30") };
    const notes = [at("09:10"), at("10:40"), at("12:05"), at("12:50")].map((t) => ({ at: t }));
    const r = updateWindows(shift, notes, hourly, at("18:00"));
    expect(r.expected).toBe(4); // 9-10, 10-11, 11-12, 12-13; 13-13:30 is a part window
    expect(r.met).toBe(3); // 11-12 had none
    expect(updateWindows({ startedAt: at("09:00"), endedAt: null }, [], hourly, at("10:59")).expected).toBe(1);
  });

  it("across a project switch, the new shift starts its own windows", () => {
    const a = updateWindows({ startedAt: at("09:00"), endedAt: at("10:30") }, [{ at: at("09:20") }], hourly, at("12:00"));
    const b = updateWindows({ startedAt: at("10:30"), endedAt: null }, [{ at: at("10:45") }], () => 30, at("11:40"));
    expect([a.expected, a.met]).toEqual([1, 1]);
    expect(b.windows.map((w) => w.to.toISOString().slice(11, 16))).toEqual(["11:00", "11:30"]);
    expect([b.expected, b.met]).toEqual([2, 1]);
  });

  it("a cadence changed mid-shift applies from the next window", () => {
    const project: { cadenceHistory: CadenceEntry[] } = { cadenceHistory: [{ from: at("00:00").toISOString(), minutes: 60 }] };
    project.cadenceHistory = withChange(project.cadenceHistory, 30, at("10:20")); // during the 10-11 window
    const c = cadenceFor(project, {});
    const r = updateWindows({ startedAt: at("09:00"), endedAt: at("12:00") }, [], c, at("12:00"));
    expect(r.windows.map((w) => w.to.toISOString().slice(11, 16))).toEqual(["10:00", "11:00", "11:30", "12:00"]);
  });

  it("the project's cadence, else the company default, else none", () => {
    const settings = { updates: { defaultHistory: [{ from: at("00:00").toISOString(), minutes: 120 }] } };
    expect(cadenceFor(null, settings)(at("09:00"))).toBe(120); // General
    expect(cadenceFor({ cadenceHistory: [{ from: at("00:00").toISOString(), minutes: null }] }, settings)(at("09:00"))).toBe(120);
    expect(cadenceFor({ cadenceHistory: [{ from: at("00:00").toISOString(), minutes: 30 }] }, settings)(at("09:00"))).toBe(30);
    expect(cadenceFor(null, {})(at("09:00"))).toBe(0);
    expect(entryAt([], at("09:00"))).toBeUndefined();
  });
});

describe("live state", () => {
  const shift = { startedAt: at("09:00"), endedAt: null };
  it("due at the end of the window under way; overdue when the last window ended without a note", () => {
    expect(liveUpdate(shift, [], hourly, at("09:48"))).toMatchObject({ dueAt: at("10:00"), overdueSince: null });
    expect(liveUpdate(shift, [], hourly, at("10:12"))).toMatchObject({ dueAt: at("11:00"), overdueSince: at("10:00") });
    // posting a note clears it
    expect(liveUpdate(shift, [{ at: at("10:13") }], hourly, at("10:14"))).toMatchObject({ postedThisWindow: true, overdueSince: null });
    expect(liveUpdate(shift, [], () => 0, at("10:14")).dueAt).toBeNull();
  });
});

describe("rounding", () => {
  it("start down, end up, to the step; 0 leaves the times", () => {
    const r = roundShift(at("09:07"), at("12:02"), 15);
    expect([r.startedAt, r.endedAt]).toEqual([at("09:00"), at("12:15")]);
    expect(roundShift(at("09:07"), at("12:02"), 0).startedAt).toEqual(at("09:07"));
  });
});

describe("on the database", () => {
  it("Team now flags an overdue update; the project log lists the day's updates in order with the time on it", async () => {
    const { memoryDb } = await import("@/lib/db");
    const { addProject, setProjectCadence } = await import("@/lib/projects");
    const { postNote, projectLog, teamNow } = await import("@/lib/shift-notes");
    const { addUser, clockIn, clockOut, createTenant } = await import("@/lib/tenants");
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
    const p = await addProject(db, tenant.id, "Client site", "Candy Co");
    if (!p.ok) throw new Error(p.error);
    await setProjectCadence(db, tenant.id, p.project.id, 60, at("00:00"));
    await clockIn(db, tenant.id, ann.id, at("09:00"), p.project.id);
    await postNote(db, tenant.id, ann.id, "homepage copy", at("09:20"));
    // 9-10 had a note; 10-11 ended without one: overdue at 11:10, cleared by the next note
    expect((await teamNow(db, tenant.id, {}, at("10:30")))[0].overdueSince).toBeNull();
    expect((await teamNow(db, tenant.id, {}, at("11:10")))[0].overdueSince).toEqual(at("11:00"));
    await postNote(db, tenant.id, ann.id, "contact form", at("11:15"));
    expect((await teamNow(db, tenant.id, {}, at("11:16")))[0].overdueSince).toBeNull();
    await clockOut(db, tenant.id, ann.id, at("11:30"));
    const log = await projectLog(db, tenant.id, p.project.id, at("00:00"), new Date(at("00:00").getTime() + 86400e3));
    expect(log.lines.map((l) => `${l.name}: ${l.text}`)).toEqual(["Ann: homepage copy", "Ann: contact form"]);
    expect(log.minutes).toBe(150);
  });
});
