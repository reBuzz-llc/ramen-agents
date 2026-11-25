// (b) the daily stale-task sweep -- Not started, made by a bot, touched by no person, older than 14 days
// (7 on the first run), archived with its note and history, one job log line per company; (a) a key's change to one
// package, with its history line, the stale-write 409 and the published fence.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { keyPatchPackage, listPackages, savePackages } from "@/lib/assets";
import { memoryDb } from "@/lib/db";
import { assetPackageChanges, claims, jobRuns, tasks } from "@/lib/db/schema";
import type { Actor } from "@/lib/leads";
import { writeTask } from "@/lib/tasks";
import { runStaleTasks } from "@/lib/stale-tasks";
import { createTenant } from "@/lib/tenants";

const CEO: Actor = { kind: "bot", name: "The CEO", via: "engine" };
const DAY = 86400e3;

describe("the stale-task sweep", () => {
  it("archives only bot-made, untouched Not started tasks past the age; 7 days on the first run, 14 after; logs the count", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const NOW = new Date("2026-11-14T09:00:00Z");
    const make = async (title: string, by: Actor, ageDays: number, extra: Record<string, unknown> = {}) => {
      const r = await writeTask(db, tenant.id, {}, { title, ...extra }, by, { create: true });
      if (!r.ok) throw new Error(r.message);
      const id = String(r.task.id);
      await db.update(tasks).set({ createdAt: new Date(NOW.getTime() - ageDays * DAY) }).where(eq(tasks.id, id));
      return id;
    };
    const stale10 = await make("Research three cafés", CEO, 10);
    const stale20 = await make("Draft a menu page", CEO, 20, { details: "From the CEO's plan." });
    const fresh = await make("New today", CEO, 2);
    const byPerson = await make("Olu's own", OLU, 20);
    const touched = await make("Olu edited it", CEO, 20);
    expect(await writeTask(db, tenant.id, { id: touched }, { priority: "P1" }, OLU)).toMatchObject({ ok: true });
    const held = await make("Someone holds it", CEO, 20);
    await db.insert(claims).values({ tenantId: tenant.id, pageId: held, userId: owner.id });
    const started = await make("Already going", CEO, 20);
    await writeTask(db, tenant.id, { id: started }, { status: "In progress" }, OLU);

    const first = await runStaleTasks(db, NOW);
    expect(first).toEqual({ days: 7, archived: { acme: 2 } });
    const rows = await db.select().from(tasks);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect([stale10, stale20].map((id) => by(id).archived)).toEqual([true, true]);
    expect([fresh, byPerson, touched, held, started].map((id) => by(id).archived)).toEqual([false, false, false, false, false]);
    expect(by(stale10).details).toBe("archived 2026-11-14, owner: stale");
    expect(by(stale20).details).toBe("From the CEO's plan.\n\narchived 2026-11-14, owner: stale");
    expect(await db.select({ count: jobRuns.count, job: jobRuns.job }).from(jobRuns)).toEqual([{ count: 2, job: "stale-tasks" }]);

    // later runs: 14 days; a 10-day-old bot task waits, a 15-day-old one goes
    const ten = await make("Ten days old", CEO, 10);
    const fifteen = await make("Fifteen days old", CEO, 15);
    const second = await runStaleTasks(db, NOW);
    expect(second).toEqual({ days: 14, archived: { acme: 1 } });
    const after = await db.select().from(tasks);
    expect(after.find((r) => r.id === fifteen)!.archived).toBe(true);
    expect(after.find((r) => r.id === ten)!.archived).toBe(false);
  });
});

describe("a key's change to one package", () => {
  it("changes only the fields given, keeps a history line, refuses a stale write and a published package's price", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const P = (name: string, status: "draft" | "published") => ({ name, price: "$990", offer: "", buyer: "", deliverables: [], status, email: "Hi,\n\nWe are in your city.", why: "", sources: [] });
    await savePackages(db, tenant.id, [P("Starter Website", "published"), P("Care Plan", "draft")], "Olu");
    const [pub, draft] = await listPackages(db, tenant.id);
    const r = await keyPatchPackage(db, tenant.id, pub.id, { email: "Hi,\n\nWe work with shops like yours, remotely." }, "Outreach Writer", "engine", pub.updatedAt);
    expect(r).toMatchObject({ ok: true, package: { email: "Hi,\n\nWe work with shops like yours, remotely.", price: "$990", updatedBy: "Outreach Writer" } });
    expect(await db.select({ field: assetPackageChanges.field, old: assetPackageChanges.old, new: assetPackageChanges.new, by: assetPackageChanges.by, via: assetPackageChanges.via }).from(assetPackageChanges))
      .toEqual([{ field: "email", old: "Hi,\n\nWe are in your city.", new: "Hi,\n\nWe work with shops like yours, remotely.", by: "Outreach Writer", via: "engine" }]);
    // the same read again is stale now
    expect(await keyPatchPackage(db, tenant.id, pub.id, { email: "x" }, "Writer", "engine", pub.updatedAt)).toMatchObject({ ok: false, status: 409 });
    // a published package's price waits for the owner; a draft's may change
    expect(await keyPatchPackage(db, tenant.id, pub.id, { price: "$1,200" }, "Writer", "engine")).toMatchObject({ ok: false, status: 405 });
    expect(await keyPatchPackage(db, tenant.id, draft.id, { price: "$120 a month", name: "Care Plan Plus" }, "Writer", "engine")).toMatchObject({ ok: true, package: { price: "$120 a month", name: "Care Plan Plus" } });
    expect(await keyPatchPackage(db, tenant.id, draft.id, { status: "published" }, "Writer", "engine")).toMatchObject({ ok: false, status: 400, message: /not status/ });
    expect(await keyPatchPackage(db, tenant.id, "00000000-0000-0000-0000-000000000000", { email: "x" }, "Writer", "engine")).toMatchObject({ ok: false, status: 404 });
  });
});
