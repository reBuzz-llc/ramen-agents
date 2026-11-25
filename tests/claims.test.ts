import { describe, expect, it } from "vitest";
import { accept, claimsOf, closeClaim, holderOf, release, takenCounts, takenLeads } from "@/lib/claims";
import { memoryDb } from "@/lib/db";
import { addUser, createTenant } from "@/lib/tenants";

const PAGE = "3e3d905f-ccff-80fe-9d00-000b133cee18";

describe("accepting a lead", () => {
  it("one person per lead; the first wins, a second is told who has it", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
    const bo = await addUser(db, tenant.id, "bo@acme.example", "Bo");
    expect(await accept(db, tenant.id, PAGE, ann.id)).toEqual({ ok: true });
    expect(await accept(db, tenant.id, PAGE, ann.id)).toEqual({ ok: true }); // again: no-op
    expect(await accept(db, tenant.id, PAGE, bo.id)).toEqual({ ok: false, takenBy: "Ann" });
    expect((await claimsOf(db, tenant.id)).get(PAGE)?.name).toBe("Ann");

    // a member cannot release someone else's lead; the owner can
    expect((await release(db, tenant.id, PAGE, { userId: bo.id, role: "member" })).ok).toBe(false);
    expect((await release(db, tenant.id, PAGE, { userId: owner.id, role: "owner" })).ok).toBe(true);
    expect(await holderOf(db, tenant.id, PAGE)).toBeNull();

    // sent: the claim closes
    await accept(db, tenant.id, PAGE, bo.id);
    await closeClaim(db, tenant.id, PAGE);
    expect((await claimsOf(db, tenant.id)).size).toBe(0);
  });

  it("parallel accepts: exactly one wins", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const people = await Promise.all(["a", "b", "c", "d"].map((n) => addUser(db, tenant.id, `${n}@acme.example`, n)));
    const r = await Promise.all(people.map((u) => accept(db, tenant.id, PAGE, u.id)));
    expect(r.filter((x) => x.ok)).toHaveLength(1);
  });

  it("taken counts: the leads each person holds now; a sent lead leaves the count", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
    const bo = await addUser(db, tenant.id, "bo@acme.example", "Bo");
    await accept(db, tenant.id, "p1", ann.id);
    await accept(db, tenant.id, "p2", ann.id, "whatsapp");
    await accept(db, tenant.id, "p3", bo.id);
    expect(await takenCounts(db, tenant.id)).toEqual(new Map([[ann.id, 2], [bo.id, 1]]));
    await closeClaim(db, tenant.id, "p3");
    expect((await takenCounts(db, tenant.id)).get(bo.id)).toBeUndefined();
  });

  it("taken leads: one person's leads with the business, oldest first", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
    const { leads } = await import("@/lib/db/schema");
    const [a, b] = await db.insert(leads).values([{ tenantId: tenant.id, business: "Alpha Deli", city: "Austin", state: "TX" }, { tenantId: tenant.id, business: "Beta Shoes" }]).returning();
    await accept(db, tenant.id, b.id, ann.id, "whatsapp");
    await accept(db, tenant.id, a.id, ann.id);
    const got = await takenLeads(db, tenant.id, ann.id);
    expect(got.map((r) => [r.business, r.kind])).toEqual([["Beta Shoes", "whatsapp"], ["Alpha Deli", "email"]]);
    expect(got[1].city).toBe("Austin");
  });
});
