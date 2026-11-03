// The clock as home: the routes, the nav's current page, the picker's default, and fixing a
// shift's project.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentNav, MENU, NAV } from "@/app/nav-links";
import { memoryDb } from "@/lib/db";
import { defaultProject, dropdownOptions } from "@/lib/project-picker";
import { addProject, setShiftProject } from "@/lib/projects";
import { clockIn, clockOut, createTenant, shiftsSince } from "@/lib/tenants";

const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const P = (id: string, name: string, active = true) => ({ id, name, client: "", active });

describe("routes", () => {
  it("home is the clock, /clock redirects home, the leaderboard has its own page; the bar is the daily work, the rest in the profile menu", () => {
    expect(src("app/page.tsx")).toMatch(/import ClockView from "\.\/clock\/clock-view"/);
    expect(src("app/clock/page.tsx")).toMatch(/redirect\("\/"\)/);
    expect(src("app/leaderboard/page.tsx")).toMatch(/standings\(/);
    expect(NAV.map((n) => n.label)).toEqual(["Clock", "Our queue", "Leads", "Files"]);
    expect(MENU.map((n) => n.label)).toEqual(["Leaderboard", "This week", "Settings", "Privacy"]);
    expect(src("app/settings/layout.tsx")).toMatch(/Projects are managed on the/);
  });
  it("the nav marks the page you are on", () => {
    expect([currentNav("/"), currentNav("/clock"), currentNav("/leaderboard"), currentNav("/leads"), currentNav("/week/statement/x"), currentNav("/settings"), currentNav("/projects/general"), currentNav("/privacy"), currentNav("/help/x")]).toEqual([
      "/",
      "/",
      "/leaderboard",
      "/leads",
      "/week",
      "/settings",
      "/",
      "/privacy",
      null,
    ]);
  });
});

describe("the project picker's default", () => {
  const projects = [P("a", "Website care"), P("b", "Lead research"), P("c", "Old", false)];
  it("running shift's project; else the person's pick; else the last-used if still open; else General", () => {
    expect(defaultProject({ clockedIn: true, openProjectId: "b", picked: "a", last: "a", projects })).toBe("b");
    expect(defaultProject({ clockedIn: false, picked: "a", last: "b", projects })).toBe("a");
    expect(defaultProject({ clockedIn: false, picked: null, last: "b", projects })).toBeNull(); // picked General
    expect(defaultProject({ clockedIn: false, picked: undefined, last: "b", projects })).toBe("b");
    expect(defaultProject({ clockedIn: false, picked: undefined, last: "c", projects })).toBeNull(); // archived since
    expect(defaultProject({ clockedIn: false, picked: undefined, last: null, projects })).toBeNull();
  });
  it("the dropdown lists recent first, then the other open ones; never archived", () => {
    const d = dropdownOptions(projects, ["b", null]);
    expect(d.recent.map((o) => o.name)).toEqual(["Lead research", "General"]);
    expect(d.rest.map((o) => o.name)).toEqual(["Website care"]);
  });
});

describe("fixing a shift's project", () => {
  it("your own shift from today only", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "O" });
    const a = await addProject(db, tenant.id, "Website care");
    if (!a.ok) throw new Error(a.error);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await clockIn(db, tenant.id, owner.id, new Date(today.getTime() + 9 * 3600e3));
    await clockOut(db, tenant.id, owner.id, new Date(today.getTime() + 10 * 3600e3));
    const [s] = await shiftsSince(db, tenant.id, owner.id, today);
    expect(await setShiftProject(db, tenant.id, owner.id, s.id, a.project.id, today)).toEqual({ ok: true });
    expect((await shiftsSince(db, tenant.id, owner.id, today))[0].projectId).toBe(a.project.id);
    const other = await createTenant(db, "Bravo", "bravo", { email: "o@bravo.example", name: "B" });
    expect((await setShiftProject(db, other.tenant.id, other.owner.id, s.id, null, today)).ok).toBe(false);
    const tomorrow = new Date(today.getTime() + 86400e3);
    expect(await setShiftProject(db, tenant.id, owner.id, s.id, null, tomorrow)).toEqual({ ok: false, reason: "Only today's shifts can be changed here." });
  });
});
