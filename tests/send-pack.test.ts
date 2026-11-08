// The send pack: ten leads taken per person from Send next's order, never one someone else
// holds or one already sent; Mark sent sends it as the person, closes the claim and tops the pack up; the owner sees all.
import { describe, expect, it } from "vitest";
import { accept, holderOf } from "@/lib/claims";
import { memoryDb } from "@/lib/db";
import { raiseFlag } from "@/lib/flags";
import { getLead, writeLead, type Actor } from "@/lib/leads";
import { allPacks, fillPack, markPackSent, PACK, packOf } from "@/lib/send-pack";
import { createTenant } from "@/lib/tenants";
import { users } from "@/lib/db/schema";
import type { Db } from "@/lib/db";

const addUser = async (db: Db, tenantId: string, u: { email: string; name: string; role: "member" }) =>
  (await db.insert(users).values({ tenantId, ...u }).returning())[0];

const ENGINE: Actor = { kind: "bot", name: "Outreach Writer", via: "engine" };

async function board(n: number) {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await writeLead(db, tenant.id, {}, { business: `Shop ${String(i).padStart(2, "0")}`, website: `https://shop${i}.example`, business_email: `hi@shop${i}.example`, draft_email: i === 3 ? "skip: chain" : `Hi ${i}`, lead_score: 100 - i }, ENGINE, { create: true });
    if (!r.ok) throw new Error(r.message);
    ids.push(r.lead.id);
  }
  return { db, tenantId: tenant.id, owner, ids };
}

describe("send pack", () => {
  it("fills to ten from Send next, skipping a skipped draft and a lead someone else holds; two people never share one", async () => {
    const { db, tenantId, owner, ids } = await board(25);
    const sam = await addUser(db, tenantId, { email: "sam@acme.example", name: "Sam", role: "member" });
    await accept(db, tenantId, ids[0], sam.id); // Sam already holds the best one
    expect(await fillPack(db, tenantId, owner.id)).toBe(PACK);
    const mine = await packOf(db, tenantId, owner.id);
    expect(mine).toHaveLength(PACK);
    expect(mine.map((l) => l.business)).not.toContain("Shop 00");
    expect(mine.map((l) => l.business)).not.toContain("Shop 03");
    expect(await fillPack(db, tenantId, owner.id)).toBe(0); // full
    expect(await fillPack(db, tenantId, sam.id)).toBe(PACK - 1);
    const sams = await packOf(db, tenantId, sam.id);
    expect(sams.some((l) => mine.some((m) => m.id === l.id))).toBe(false);
    const all = await allPacks(db, tenantId);
    expect(all.map((p) => [p.name, p.leads.length]).sort()).toEqual([
      ["Olu", PACK],
      ["Sam", PACK],
    ]);
  });

  it("shows open flags inline; Mark sent sends as the person, closes the claim and tops up", async () => {
    const { db, tenantId, owner, ids } = await board(15);
    await fillPack(db, tenantId, owner.id);
    const first = (await packOf(db, tenantId, owner.id))[0];
    await raiseFlag(db, tenantId, first.id, "OW09", "an invented figure", "validator");
    expect((await packOf(db, tenantId, owner.id))[0].flags).toEqual([{ rule: "OW09", detail: "an invented figure", changed: false }]);

    const r = await markPackSent(db, tenantId, first.id, { userId: owner.id, name: "Olu" }, new Date("2026-11-09T09:00:00Z"));
    expect(r).toEqual({ ok: true, added: 1 });
    const lead = await getLead(db, tenantId, { id: first.id });
    expect(lead).toMatchObject({ email_status: "Email Sent", result: "Emailed", result_date: "2026-11-09", sent_by: ["Olu"] });
    expect(await holderOf(db, tenantId, first.id)).toBeNull();
    const after = await packOf(db, tenantId, owner.id);
    expect(after).toHaveLength(PACK);
    expect(after.map((l) => l.id)).not.toContain(first.id);
    expect(ids).toContain(first.id);
  });

  it("refuses to mark a lead that is not in the person's pack", async () => {
    const { db, tenantId, owner, ids } = await board(3);
    const sam = await addUser(db, tenantId, { email: "sam@acme.example", name: "Sam", role: "member" });
    await accept(db, tenantId, ids[0], sam.id);
    expect(await markPackSent(db, tenantId, ids[0], { userId: owner.id, name: "Olu" })).toEqual({ ok: false, error: "This lead is not in your pack any more." });
    expect((await getLead(db, tenantId, { id: ids[0] }))?.email_status).toBeNull();
  });
});
