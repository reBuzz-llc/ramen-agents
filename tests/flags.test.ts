import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { flagsOf, raiseFlag, resolveFlag } from "@/lib/flags";
import { boardOf, writeLead, type Actor } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";

const VALIDATOR: Actor = { kind: "bot", name: "validator", via: "validator", validator: true };
const ENGINE: Actor = { kind: "bot", name: "Lead Enricher", via: "engine" };

async function board() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, tenant.id, {}, { business: "Acme Bakery", website: "https://acmebakery.example", whatsapp: "https://wa.me/17185550100" }, ENGINE, { create: true });
  if (!r.ok) throw new Error(r.message);
  return { db, tenantId: tenant.id, owner, OLU, id: r.lead.id };
}

describe("flags", () => {
  it("raise is an upsert by rule; resolve; raise again reopens the same flag; list; the board counts open ones", async () => {
    const { db, tenantId, owner, id } = await board();
    const a = await raiseFlag(db, tenantId, id, "LD21", "pain point is not three lines", "validator");
    expect(a).toMatchObject({ rule: "LD21", detail: "pain point is not three lines", status: "open", resolved_at: null });
    const again = await raiseFlag(db, tenantId, id, "LD21", "still not three lines", "validator");
    expect(again).toMatchObject({ id: a!.id, detail: "still not three lines", status: "open", first_seen: a!.first_seen });
    await raiseFlag(db, tenantId, id, "LD12", "email bounced", "validator");
    expect((await boardOf(db, tenantId, owner.id))[0].openFlags).toBe(2);
    const done = await resolveFlag(db, tenantId, id, a!.id, "validator");
    expect(done).toMatchObject({ id: a!.id, status: "resolved" });
    expect(done!.resolved_at).toBeTruthy();
    expect((await boardOf(db, tenantId, owner.id))[0].openFlags).toBe(1);
    const reopened = await raiseFlag(db, tenantId, id, "LD21", "back again", "validator");
    expect(reopened).toMatchObject({ id: a!.id, status: "open", resolved_at: null });
    expect((await flagsOf(db, tenantId, id))!.map((f) => [f.rule, f.status])).toEqual([
      ["LD21", "open"],
      ["LD12", "open"],
    ]);
  });

  it("another company's lead, an unknown lead or flag: nothing", async () => {
    const { db, id } = await board();
    const other = await createTenant(db, "Bravo", "bravo", { email: "o@bravo.example", name: "B" });
    expect(await raiseFlag(db, other.tenant.id, id, "LD1", "x", "validator")).toBeNull();
    expect(await flagsOf(db, other.tenant.id, id)).toBeNull();
    expect(await resolveFlag(db, other.tenant.id, id, "00000000-0000-4000-8000-000000000000", "validator")).toBeNull();
  });
});

describe("the Validator's one exception to the team's fields", () => {
  it("clears a False Whatsapp Number, even one a person set; nothing else", async () => {
    const { db, tenantId, OLU, id } = await board();
    await writeLead(db, tenantId, { id }, { whatsapp_status: "False Whatsapp Number" }, OLU);
    // another bot, or the Validator setting any value, or clearing another value: refused
    expect((await writeLead(db, tenantId, { id }, { whatsapp_status: null }, ENGINE)).ok && "refused").toBeTruthy();
    const eng = await writeLead(db, tenantId, { id }, { whatsapp_status: null }, ENGINE);
    expect(eng.ok && eng.refused.map((r) => r.reason)).toEqual(["human_only"]);
    const set = await writeLead(db, tenantId, { id }, { whatsapp_status: "WhatsApp Verified" }, VALIDATOR);
    expect(set.ok && set.refused.map((r) => r.reason)).toEqual(["human_only"]);
    const other = await writeLead(db, tenantId, { id }, { email_status: null, result: "Client" }, VALIDATOR);
    expect(other.ok && other.written).toEqual([]);
    // the clean-up itself
    const clear = await writeLead(db, tenantId, { id }, { whatsapp_status: null, whatsapp: null }, VALIDATOR);
    expect(clear.ok && clear.written.sort()).toEqual(["whatsapp", "whatsapp_status"]);
    expect(clear.ok && clear.lead.whatsapp_status).toBeNull();
    // with any other status in place, clearing is refused again
    await writeLead(db, tenantId, { id }, { whatsapp_status: "WhatsApp Verified" }, OLU);
    const no = await writeLead(db, tenantId, { id }, { whatsapp_status: null }, VALIDATOR);
    expect(no.ok && no.written).toEqual([]);
  });
});
