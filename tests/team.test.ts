import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { userForSignIn } from "@/lib/bootstrap";
import { memoryDb } from "@/lib/db";
import { claims, shifts, users } from "@/lib/db/schema";
import { principalByEmail } from "@/lib/principal";
import { addMember, canAdd, canRemove, copyText, markSignedIn, removeMember } from "@/lib/team";
import { signInLink } from "@/lib/team-text";
import { addUser, createTenant } from "@/lib/tenants";

async function company() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  return { db, tenant, owner, by: { userId: owner.id, role: owner.role } };
}

describe("adding a member by Google address", () => {
  it("makes the row only; their first Google sign-in with exactly that address lets them in, once stamped", async () => {
    const { db, tenant, by } = await company();
    const r = await addMember(db, tenant.id, { email: " Ann@Acme.example ", name: "Ann", role: "member" }, by);
    expect(r).toMatchObject({ ok: true, member: { email: "ann@acme.example", role: "member", reactivated: false } });
    const [row] = await db.select().from(users).where(eq(users.email, "ann@acme.example"));
    expect(row).toMatchObject({ tenantId: tenant.id, active: true, firstSignedInAt: null }); // "invited, not signed in yet"
    // Google answers with the address (any case): the sign-in finds the row, in this company, with its role
    const signIn = await userForSignIn(db, "ANN@acme.example", "Ann G.");
    expect(signIn).toMatchObject({ ok: true, user: { id: row.id, tenantId: tenant.id, role: "member" } });
    expect((await principalByEmail(db, "ann@acme.example"))?.tenantName).toBe("Acme");
    await markSignedIn(db, row.id, new Date("2026-11-02T13:00:00Z"));
    await markSignedIn(db, row.id, new Date("2026-11-03T13:00:00Z")); // later sign-ins change nothing
    expect((await principalByEmail(db, "ann@acme.example"))?.firstSignedInAt?.toISOString()).toBe("2026-11-02T13:00:00.000Z");
  });

  it("an unknown Google address gets no company: it lands on 'Not on a team yet'", async () => {
    const { db } = await company();
    expect(await userForSignIn(db, "stranger@gmail.example", "S")).toEqual({ ok: false, reason: "no account for that email: ask your company's owner or a manager to add your Google address" });
    expect(await principalByEmail(db, "stranger@gmail.example")).toBeNull();
    expect(await db.select().from(users)).toHaveLength(1); // no new company, no new row
  });

  it("refuses a duplicate, another company's person and a bad address", async () => {
    const { db, tenant, by } = await company();
    await addMember(db, tenant.id, { email: "bo@acme.example", name: "Bo", role: "member" }, by);
    expect(await addMember(db, tenant.id, { email: "bo@acme.example", name: "Bo", role: "member" }, by)).toEqual({ ok: false, error: "bo@acme.example is already on the team." });
    const other = await createTenant(db, "Bravo", "bravo", { email: "o@bravo.example", name: "B" });
    expect(await addMember(db, other.tenant.id, { email: "bo@acme.example", name: "Bo", role: "member" }, { userId: other.owner.id, role: "owner" })).toMatchObject({ ok: false });
    expect(await addMember(db, tenant.id, { email: "not-an-email", name: "", role: "member" }, by)).toMatchObject({ ok: false });
  });

  it("role limits: the owner adds members and managers, a manager members only, a member nobody", async () => {
    expect([canAdd("owner", "member"), canAdd("owner", "manager"), canAdd("manager", "member"), canAdd("manager", "manager"), canAdd("member", "member")]).toEqual([true, true, true, false, false]);
    const { db, tenant } = await company();
    const mgr = await addUser(db, tenant.id, "m@acme.example", "Mo", "manager");
    const mem = await addUser(db, tenant.id, "x@acme.example", "Xi");
    expect(await addMember(db, tenant.id, { email: "d@acme.example", name: "D", role: "manager" }, { userId: mgr.id, role: "manager" })).toMatchObject({ ok: false });
    expect(await addMember(db, tenant.id, { email: "d@acme.example", name: "D", role: "member" }, { userId: mem.id, role: "member" })).toMatchObject({ ok: false });
    expect((await addMember(db, tenant.id, { email: "d@acme.example", name: "D", role: "member" }, { userId: mgr.id, role: "manager" })).ok).toBe(true);
  });

  it("copy text for Slack", () => {
    expect(copyText("https://peek.example/", { email: "ann@acme.example", name: "Ann Lee", ownerName: "Kai Morgan" })).toBe(
      "Hi Ann, you're set up on ramen-agents, our team's queue and clock. Sign in here: https://peek.example/sign-in — use Continue with Google with ann@acme.example (no password needed). First things: clock in on the home page when you start, and open Our queue for the drafts to review and send. Questions, ask Kai.",
    );
    // copied on someone's own Mac, the link is still the live app's; no names, no empty greeting or "ask"
    expect(copyText("http://localhost:3100", { email: "bo@acme.example" })).toBe(
      "Hi, you're set up on ramen-agents, our team's queue and clock. Sign in here: https://your-team.example/sign-in — use Continue with Google with bo@acme.example (no password needed). First things: clock in on the home page when you start, and open Our queue for the drafts to review and send.",
    );
    expect(signInLink("http://127.0.0.1:3100/")).toBe("https://your-team.example/sign-in");
  });
});

describe("removing a member", () => {
  it("deletes one who never signed in; keeps the history of one who did and closes the door; adding again restores", async () => {
    const { db, tenant, owner, by } = await company();
    const a = await addMember(db, tenant.id, { email: "new@acme.example", name: "New", role: "member" }, by);
    if (!a.ok) throw new Error(a.error);
    expect(await removeMember(db, tenant.id, a.member.id, by)).toMatchObject({ ok: true, deleted: true });
    expect(await db.select().from(users).where(eq(users.email, "new@acme.example"))).toHaveLength(0);

    const b = await addMember(db, tenant.id, { email: "old@acme.example", name: "Old", role: "member" }, by);
    if (!b.ok) throw new Error(b.error);
    await markSignedIn(db, b.member.id);
    await db.insert(shifts).values({ tenantId: tenant.id, userId: b.member.id, endedAt: new Date() });
    await db.insert(claims).values({ tenantId: tenant.id, pageId: "p1", userId: b.member.id });
    expect(await removeMember(db, tenant.id, b.member.id, by)).toMatchObject({ ok: true, deleted: false });
    expect(await principalByEmail(db, "old@acme.example")).toBeNull(); // can't get in
    expect(await db.select().from(shifts)).toHaveLength(1); // hours kept
    expect(await db.select().from(claims)).toHaveLength(0); // taken leads back in the queue
    const again = await addMember(db, tenant.id, { email: "old@acme.example", name: "", role: "manager" }, by);
    expect(again).toMatchObject({ ok: true, member: { reactivated: true, role: "manager", name: "Old" } });
    expect((await principalByEmail(db, "old@acme.example"))?.role).toBe("manager");

    // limits: never the owner, never yourself, a manager members only, never another company's person
    const mgr = await addUser(db, tenant.id, "m@acme.example", "Mo", "manager");
    const asMgr = { userId: mgr.id, role: "manager" as const };
    expect((await removeMember(db, tenant.id, owner.id, by)).ok).toBe(false);
    expect((await removeMember(db, tenant.id, owner.id, asMgr)).ok).toBe(false);
    expect((await removeMember(db, tenant.id, b.member.id, asMgr)).ok).toBe(false); // now a manager
    expect((await removeMember(db, tenant.id, mgr.id, asMgr)).ok).toBe(false); // themselves
    const other = await createTenant(db, "Bravo", "bravo", { email: "o@bravo.example", name: "B" });
    expect((await removeMember(db, other.tenant.id, mgr.id, { userId: other.owner.id, role: "owner" })).ok).toBe(false);
    expect(canRemove({ id: "a", role: "owner" }, { id: "b", role: "manager" })).toBe(true);
  });
});
