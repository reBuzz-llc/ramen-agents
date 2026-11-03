import { beforeAll, describe, expect, it } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";
import { memoryDb } from "@/lib/db";
import { addUser, clockIn, clockOut, connectNotion, createTenant, notionOf, shiftsSince, userByEmail } from "@/lib/tenants";

beforeAll(() => {
  process.env.TEAMS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("tenants", () => {
  it("keeps each company's people and Notion token apart, the token encrypted at rest", async () => {
    const db = await memoryDb();
    const a = await createTenant(db, "Acme", "acme", { email: "Owner@Acme.example", name: "Ann" });
    const b = await createTenant(db, "Bravo", "bravo", { email: "owner@bravo.example", name: "Bo" });
    await addUser(db, a.tenant.id, "jo@acme.example", "Jo");
    expect(a.owner.role).toBe("owner");
    expect((await userByEmail(db, a.tenant.id, "OWNER@acme.example"))?.name).toBe("Ann"); // emails compare lower-case
    expect(await userByEmail(db, b.tenant.id, "jo@acme.example")).toBeNull(); // another company's person is invisible
    await connectNotion(db, a.tenant.id, "secret_abc", "ds-1");
    const raw = await db.query.notionConnections.findFirst();
    expect(raw?.tokenEncrypted).not.toContain("secret_abc");
    expect((await notionOf(db, a.tenant.id))?.token).toBe("secret_abc");
    expect(await notionOf(db, b.tenant.id)).toBeNull();
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

  it("refuses to decrypt with the wrong key", () => {
    const k1 = Buffer.alloc(32, 1).toString("base64");
    const k2 = Buffer.alloc(32, 2).toString("base64");
    expect(() => decrypt(encrypt("x", k1), k2)).toThrow();
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
