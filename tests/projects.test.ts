import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { addProject, lastProject, mergeProjects, pickerOptions, projectName, projectsOf, renameProject, setProjectActive, usableProject } from "@/lib/projects";
import { clockIn, clockOut, createTenant, shiftsSince, switchProject } from "@/lib/tenants";
import { minutesByProject } from "@/lib/timesheet";

const at = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00Z`);

describe("projects at clock-in", () => {
  it("switching mid-day closes the shift and opens another at the same moment; minutes add up per project", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const site = await addProject(db, tenant.id, "Website", "Luna Hair");
    if (!site.ok) throw new Error(site.error);
    const pid = site.project.id;

    await clockIn(db, tenant.id, owner.id, at("09:00"), pid);
    expect((await switchProject(db, tenant.id, owner.id, pid, at("09:30"))).ok).toBe(true); // same project: nothing changes
    await switchProject(db, tenant.id, owner.id, null, at("11:00")); // to General
    await clockOut(db, tenant.id, owner.id, at("12:15"));
    await clockIn(db, tenant.id, owner.id, at("13:00"), pid);
    await clockOut(db, tenant.id, owner.id, at("14:00"));

    const shifts = await shiftsSince(db, tenant.id, owner.id, at("00:00"));
    expect(shifts).toHaveLength(3);
    const by = minutesByProject(shifts);
    expect(by.get(pid)).toBe(120 + 60);
    expect(by.get(null)).toBe(75);
    expect(await lastProject(db, tenant.id, owner.id)).toBe(pid); // the clock remembers the last choice
    expect(projectName(await projectsOf(db, tenant.id), null)).toBe("General");
  });

  it("an open shift counts up to now; switching while clocked out is refused", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    expect((await switchProject(db, tenant.id, owner.id, null, at("09:00"))).ok).toBe(false);
    await clockIn(db, tenant.id, owner.id, at("09:00"));
    expect(minutesByProject(await shiftsSince(db, tenant.id, owner.id, at("00:00")), at("09:45")).get(null)).toBe(45);
  });

  it("General is built in; a closed project or another company's cannot be clocked in to", async () => {
    const db = await memoryDb();
    const a = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const b = await createTenant(db, "Bravo", "bravo", { email: "o@bravo.example", name: "Bo" });
    expect((await addProject(db, a.tenant.id, "general")).ok).toBe(false);
    const p = await addProject(db, a.tenant.id, "Website");
    if (!p.ok) throw new Error(p.error);
    expect((await addProject(db, a.tenant.id, "Website")).ok).toBe(false); // names are unique per company
    expect(await usableProject(db, a.tenant.id, "")).toBeNull(); // General
    expect(await usableProject(db, a.tenant.id, p.project.id)).toBe(p.project.id);
    expect(await usableProject(db, b.tenant.id, p.project.id)).toBeUndefined();
    await setProjectActive(db, a.tenant.id, p.project.id, false);
    expect(await usableProject(db, a.tenant.id, p.project.id)).toBeUndefined();
  });
});

describe("the project picker", () => {
  const list = [
    { id: "w", name: "Website", client: "Luna Hair", active: true },
    { id: "s", name: "SEO", client: "Luna Hair", active: true },
    { id: "a", name: "App rebuild", client: "Mokka", active: true },
    { id: "old", name: "Old website", client: "", active: false },
  ];
  it("lists recent first, then General and the rest by name; archived never", () => {
    const { options } = pickerOptions(list, ["s", null], "");
    expect(options.map((o) => o.id)).toEqual(["s", null, "a", "w"]);
    expect(options.find((o) => o.id === "old")).toBeUndefined();
  });
  it("filters on every typed word, in the name or the client", () => {
    expect(pickerOptions(list, [], "luna").options.map((o) => o.id)).toEqual(["s", "w"]);
    expect(pickerOptions(list, [], "web luna").options.map((o) => o.id)).toEqual(["w"]);
    expect(pickerOptions(list, [], "old").options).toEqual([]); // archived stays hidden even when typed
  });
  it("offers to create what was typed when no project has that exact name", () => {
    expect(pickerOptions(list, [], "Brand refresh").create).toBe("Brand refresh");
    expect(pickerOptions(list, [], "website").create).toBeNull(); // exists (case does not matter)
    expect(pickerOptions(list, [], "general").create).toBeNull(); // built in
    expect(pickerOptions(list, [], "  ").create).toBeNull();
  });
});

describe("tidying projects", () => {
  it("anyone's new project records its maker; merge moves the hours and removes the duplicate; rename keeps names unique", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const a = await addProject(db, tenant.id, "Website", "", owner.id);
    const b = await addProject(db, tenant.id, "website redo", "", owner.id);
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(a.project.createdBy).toBe(owner.id);
    await clockIn(db, tenant.id, owner.id, at("09:00"), b.project.id);
    await clockOut(db, tenant.id, owner.id, at("10:00"));
    expect((await renameProject(db, tenant.id, b.project.id, "Website")).ok).toBe(false);
    expect((await mergeProjects(db, tenant.id, b.project.id, a.project.id)).ok).toBe(true);
    expect(minutesByProject(await shiftsSince(db, tenant.id, owner.id, at("00:00"))).get(a.project.id)).toBe(60);
    expect((await projectsOf(db, tenant.id)).map((p) => p.name)).toEqual(["Website"]);
  });
});
