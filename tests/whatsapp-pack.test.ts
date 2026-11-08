// The WhatsApp side of the send pack: numbers to check taken per person by lead score (nobody
// else's), the checks set as the person, verified leads to send with their draft or "draft coming", Mark WhatsApp sent
// only on a verified number, and the email pack untouched by WhatsApp claims.
import { describe, expect, it } from "vitest";
import { accept, holderOf } from "@/lib/claims";
import { memoryDb, type Db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getLead, historyOf, writeLead, WHATSAPP_SENT, type Actor } from "@/lib/leads";
import { fillPack, packOf } from "@/lib/send-pack";
import { createTenant } from "@/lib/tenants";
import { CHECK, checkList, fillChecks, markWhatsappSent, sendList, setCheck, waLink } from "@/lib/whatsapp-pack";

const ENGINE: Actor = { kind: "bot", name: "Lead Enricher", via: "engine" };
const addUser = async (db: Db, tenantId: string, name: string) => (await db.insert(users).values({ tenantId, email: `${name.toLowerCase()}@acme.example`, name, role: "member" }).returning())[0];

async function board(n: number) {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await writeLead(db, tenant.id, {}, { business: `Shop ${String(i).padStart(2, "0")}`, website: `https://shop${i}.example`, whatsapp: `https://wa.me/1718555${String(1000 + i)}`, lead_score: 100 - i, draft_email: `Hi ${i}` }, ENGINE, { create: true });
    if (!r.ok) throw new Error(r.message);
    ids.push(r.lead.id);
  }
  return { db, tenantId: tenant.id, owner, ids, OLU: { userId: owner.id, name: "Olu" } };
}

describe("waLink", () => {
  it("keeps a wa.me link, builds one from a number, none without digits", () => {
    expect(waLink("https://wa.me/17185551000", null)).toBe("https://wa.me/17185551000");
    expect(waLink(null, "+1 (718) 555-1000")).toBe("https://wa.me/17185551000");
    expect(waLink("n/a", null)).toBeNull();
  });
});

describe("WhatsApp pack", () => {
  it("takes twenty unchecked numbers by lead score, never another person's; the email pack ignores them", async () => {
    const { db, tenantId, owner, ids } = await board(30);
    const sam = await addUser(db, tenantId, "Sam");
    await accept(db, tenantId, ids[0], sam.id, "whatsapp");
    expect(await fillChecks(db, tenantId, owner.id)).toBe(CHECK);
    const mine = await checkList(db, tenantId, owner.id);
    expect(mine).toHaveLength(CHECK);
    expect(mine[0].business).toBe("Shop 01");
    expect(mine.map((l) => l.id)).not.toContain(ids[0]);
    expect(mine[0].link).toBe("https://wa.me/17185551001");
    // the email pack: none of these (taken for WhatsApp), and nothing of its own yet
    expect(await packOf(db, tenantId, owner.id)).toEqual([]);
    expect((await fillPack(db, tenantId, owner.id)) > 0).toBe(true);
    expect((await packOf(db, tenantId, owner.id)).some((l) => mine.some((m) => m.id === l.id))).toBe(false);
  });

  it("checks: verified moves to Send (draft or draft coming), asked stays to check, false lets go; sent only when verified", async () => {
    const { db, tenantId, owner, ids, OLU } = await board(6);
    await fillChecks(db, tenantId, owner.id);
    await writeLead(db, tenantId, { id: ids[0] }, { draft_whatsapp: "Hello from us" }, { kind: "bot", name: "Outreach Writer", via: "engine" });

    expect(await markWhatsappSent(db, tenantId, ids[0], OLU)).toEqual({ ok: false, error: "Check the number first: only a verified number is sent to." });
    expect(await setCheck(db, tenantId, ids[0], "verified", OLU)).toEqual({ ok: true });
    expect(await setCheck(db, tenantId, ids[1], "verified", OLU)).toEqual({ ok: true });
    expect(await setCheck(db, tenantId, ids[2], "asked", OLU)).toEqual({ ok: true });
    expect(await setCheck(db, tenantId, ids[3], "false", OLU)).toEqual({ ok: true });

    const checks = await checkList(db, tenantId, owner.id);
    expect(checks.map((l) => [l.business, l.status])).toEqual([
      ["Shop 02", "Waiting response for WhatsApp verification"],
      ["Shop 04", null],
      ["Shop 05", null],
    ]);
    expect(await holderOf(db, tenantId, ids[3])).toBeNull();
    expect((await getLead(db, tenantId, { id: ids[3] }))?.whatsapp_status).toBe("False Whatsapp Number");

    const send = await sendList(db, tenantId, owner.id);
    expect(send.map((l) => [l.business, !!l.draft, l.mine])).toEqual([
      ["Shop 00", true, true],
      ["Shop 01", false, true],
    ]);
    expect(await markWhatsappSent(db, tenantId, ids[0], OLU)).toEqual({ ok: true });
    const sent = await getLead(db, tenantId, { id: ids[0] });
    expect(sent).toMatchObject({ whatsapp_status: WHATSAPP_SENT, sent_by: ["Olu"] });
    expect(await holderOf(db, tenantId, ids[0])).toBeNull();
    expect((await historyOf(db, tenantId, ids[0])).filter((h) => h.actor.name === "Olu").map((h) => h.column)).toEqual(expect.arrayContaining(["whatsapp_status", "sent_at", "sent_by"]));
    expect((await sendList(db, tenantId, owner.id)).map((l) => l.business)).toEqual(["Shop 01"]);
  });

  it("verified leads nobody holds are offered to send; another person's number is refused", async () => {
    const { db, tenantId, owner, ids, OLU } = await board(3);
    const sam = await addUser(db, tenantId, "Sam");
    const SAM = { userId: sam.id, name: "Sam" };
    // verified by the owner's paste, held by nobody
    await writeLead(db, tenantId, { id: ids[2] }, { whatsapp_status: "WhatsApp Verified", draft_whatsapp: "Hi" }, { kind: "person", name: "Olu", userId: owner.id });
    expect((await sendList(db, tenantId, sam.id)).map((l) => [l.business, l.mine])).toEqual([["Shop 02", false]]);
    await accept(db, tenantId, ids[0], sam.id, "whatsapp");
    expect(await setCheck(db, tenantId, ids[0], "verified", OLU)).toEqual({ ok: false, error: "Someone else holds this number." });
    expect(await setCheck(db, tenantId, ids[0], "verified", SAM)).toEqual({ ok: true });
  });
});
