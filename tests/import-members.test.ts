// Members can import too: a member imports leads and sees, downloads and
// resumes their own imports only; Mark already sent stays with owners and managers, on its own action.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { memoryDb } from "@/lib/db";
import { importReportCsv, runImport } from "@/lib/lead-import";
import { can } from "@/lib/roles";
import { addUser, createTenant } from "@/lib/tenants";

const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("who may import, who may mark already sent", () => {
  it("everyone imports; only owners and managers mark sent and see everyone's imports", () => {
    for (const r of ["owner", "manager", "member"] as const) expect(can(r, "leads.import")).toBe(true);
    for (const r of ["owner", "manager"] as const) {
      expect(can(r, "leads.markSent")).toBe(true);
      expect(can(r, "leads.importsAll")).toBe(true);
    }
    expect(can("member", "leads.markSent")).toBe(false);
    expect(can("member", "leads.importsAll")).toBe(false);
  });

  it("the pages and routes ask the right action", () => {
    expect(src("app/leads/import/page.tsx")).toContain('can(who.role, "leads.import")');
    expect(src("app/leads/already-sent/page.tsx")).toContain('can(who.role, "leads.markSent")');
    expect(src("app/api/leads/import/route.ts")).toContain('guard("leads.import")');
    expect(src("app/api/leads/imports/[id]/route.ts")).toContain('guard("leads.import")');
    expect(src("app/api/leads/already-sent/route.ts")).toContain('guard("leads.markSent")');
    for (const f of ["app/leads/already-sent/page.tsx", "app/api/leads/already-sent/route.ts"]) expect(src(f)).not.toContain('"leads.import"');
  });

  it("the Leads header: Import CSV on canImport, Mark already sent on canMarkSent, both passed by the page", () => {
    expect(src("app/leads/page.tsx")).toContain('canImport={can(who.role, "leads.import")} canMarkSent={can(who.role, "leads.markSent")}');
    const v = src("app/leads/leads-view.tsx");
    const at = (s: string) => v.indexOf(s);
    expect(at("{canMarkSent ? (")).toBeGreaterThan(-1);
    expect(at("{canMarkSent ? (")).toBeLessThan(at('href="/leads/already-sent"'));
    expect(at("{canImport ? (\n              <Link")).toBeGreaterThan(at('href="/leads/already-sent"'));
    expect(at("{canImport ? (\n              <Link")).toBeLessThan(at('href="/leads/import"'));
  });
});

describe("a member's own imports", () => {
  async function team() {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ana = await addUser(db, tenant.id, "ana@acme.example", "Ana", "member");
    const ben = await addUser(db, tenant.id, "ben@acme.example", "Ben", "member");
    const row = (business: string, i: number) => ({ business, city: "Brooklyn", state: "NY", phone: `(718) 555-020${i}`, row: i + 2 });
    return { db, tenantId: tenant.id, owner: { userId: owner.id, name: "Olu" }, ana: { userId: ana.id, name: "Ana" }, ben: { userId: ben.id, name: "Ben" }, row };
  }

  it("the past imports list: a member's own; the owner's all", () => {
    const p = src("app/leads/import/page.tsx");
    expect(p).toContain('can(who.role, "leads.importsAll") ? undefined : eq(leadImports.byUserId, who.userId)');
  });

  it("a report: the member's own, nobody else's (404); the owner reads any", async () => {
    const { db, tenantId, owner, ana, ben, row } = await team();
    const a = await runImport(db, tenantId, ana, [row("Alpha Deli", 0)], "ana.csv", { ownOnly: true });
    expect(await importReportCsv(db, tenantId, a.id, ana.userId)).not.toBeNull();
    expect(await importReportCsv(db, tenantId, a.id, ben.userId)).toBeNull();
    expect(await importReportCsv(db, tenantId, a.id)).not.toBeNull(); // owner and manager pass no person
    const route = src("app/api/leads/imports/[id]/route.ts");
    expect(route).toContain('can(g.who.role, "leads.importsAll") ? undefined : g.who.userId');
    expect(route).toContain("status: 404");
    void owner;
  });

  it("a resumed run: a member's own import goes on; someone else's id starts a new record; the owner resumes any", async () => {
    const { db, tenantId, owner, ana, ben, row } = await team();
    const a = await runImport(db, tenantId, ana, [row("Alpha Deli", 0)], "ana.csv", { ownOnly: true });
    const a2 = await runImport(db, tenantId, ana, [row("Beta Barbers", 1)], "ana.csv", { ownOnly: true, importId: a.id });
    expect(a2.id).toBe(a.id);
    const b = await runImport(db, tenantId, ben, [row("Gamma Nails", 2)], "ben.csv", { ownOnly: true, importId: a.id });
    expect(b.id).not.toBe(a.id);
    expect((await importReportCsv(db, tenantId, a.id))!.csv.trim().split("\n")).toHaveLength(3); // header + Ana's two rows
    const o = await runImport(db, tenantId, owner, [row("Delta Yoga", 3)], "ana.csv", { ownOnly: false, importId: a.id });
    expect(o.id).toBe(a.id);
    expect(src("app/api/leads/import/route.ts")).toContain('ownOnly: !can(g.who.role, "leads.importsAll")');
  });
});
