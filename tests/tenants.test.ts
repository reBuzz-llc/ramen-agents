import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { addUser, clockIn, clockOut, createTenant, shiftsSince, userByEmail } from "@/lib/tenants";

describe("tenants", () => {
  it("keeps each company's people apart", async () => {
    const db = await memoryDb();
    const a = await createTenant(db, "Acme", "acme", { email: "Owner@Acme.example", name: "Ann" });
    const b = await createTenant(db, "Bravo", "bravo", { email: "owner@bravo.example", name: "Bo" });
    await addUser(db, a.tenant.id, "jo@acme.example", "Jo");
    expect(a.owner.role).toBe("owner");
    expect((await userByEmail(db, a.tenant.id, "OWNER@acme.example"))?.name).toBe("Ann"); // emails compare lower-case
    expect(await userByEmail(db, b.tenant.id, "jo@acme.example")).toBeNull(); // another company's person is invisible
  });

  it("allows one open shift per person", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "O" });
    expect((await clockIn(db, tenant.id, owner.id)).ok).toBe(true);
    expect((await clockIn(db, tenant.id, owner.id)).ok).toBe(false);
    expect((await clockOut(db, tenant.id, owner.id)).ok).toBe(true);
    expect((await clockOut(db, tenant.id, owner.id)).ok).toBe(false);
    expect(await shiftsSince(db, tenant.id, owner.id, new Date(0))).toHaveLength(1);
  });

});

describe("first sign-in", () => {
  it("creates exactly one company when the first page load signs in several times at once", async () => {
    const { userForSignIn } = await import("@/lib/bootstrap");
    const db = await memoryDb();
    const results = await Promise.all([1, 2, 3, 4].map(() => userForSignIn(db, "first@acme.example", "First")));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await db.query.tenants.findMany()).toHaveLength(1);
    expect(await db.query.users.findMany()).toHaveLength(1);
    expect((await userForSignIn(db, "stranger@acme.example")).ok).toBe(false); // nobody added them
  });
});
