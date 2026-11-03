import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { emailSteps, HEADER_FIELDS, DRAWER_ORDER, whatsappSteps } from "@/lib/lead-workflow";
import { clearStatus, getLead, historyOf, writeLead, type Actor } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";

async function board() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU = { kind: "person" as const, name: "Olu", userId: owner.id };
  const BOT: Actor = { kind: "bot", name: "backfill", via: "backfill" };
  const r = await writeLead(db, tenant.id, {}, { business: "Bravo Barbers", website: "https://bravo.example", whatsapp: "https://wa.me/1718", draft_email: "Hi" }, BOT, { create: true, import: true });
  if (!r.ok) throw new Error(r.message);
  return { db, tenantId: tenant.id, OLU, id: r.lead.id };
}

describe("the × on a status chip", () => {
  it("empties the status and the cells its step set, as one history entry; the step buttons start over", async () => {
    const { db, tenantId, OLU, id } = await board();
    await writeLead(db, tenantId, { id }, emailSteps({})[0].fields, OLU); // Ready to send
    await writeLead(db, tenantId, { id }, emailSteps({ email_status: "Ready to Send Email" })[0].fields, OLU); // Mark email sent
    const sent = await getLead(db, tenantId, { id });
    expect(sent).toMatchObject({ email_status: "Email Sent", result: "Emailed", sent_by: ["Olu"] });
    expect(emailSteps(sent!).map((s) => s.label)).toEqual(["Replied", "Won", "Lost", "Bounced"]);
    const before = (await historyOf(db, tenantId, id)).length;
    const r = await clearStatus(db, tenantId, id, "email_status", OLU);
    expect(r.ok && r.cleared.sort()).toEqual(["email_status", "result", "result_date", "sent_at", "sent_by"]);
    const after = await getLead(db, tenantId, { id });
    expect(after).toMatchObject({ email_status: null, result: null, result_date: null, sent_by: null, sent_at: null, draft_email: "Hi" });
    const h = await historyOf(db, tenantId, id);
    expect(h.length).toBe(before + 1);
    expect(h[0]).toMatchObject({ column: "cleared", reason: "cleared", actor: { kind: "person", name: "Olu" }, old: { email_status: "Email Sent", result: "Emailed" } });
    expect(emailSteps(after!).map((s) => s.label)).toEqual(["Ready to send"]); // back to the start
    expect((await clearStatus(db, tenantId, id, "email_status", OLU)).ok).toBe(false); // already empty
  });

  it("clears only what the same step wrote; a later change by someone else stays", async () => {
    const { db, tenantId, OLU, id } = await board();
    await writeLead(db, tenantId, { id }, emailSteps({ email_status: "Ready to Send Email" })[0].fields, OLU);
    await writeLead(db, tenantId, { id }, { result: "Replied", result_date: "2030-01-02" }, OLU); // a later step (a date the step itself never writes)
    const r = await clearStatus(db, tenantId, id, "email_status", OLU);
    expect(r.ok && r.cleared.sort()).toEqual(["email_status", "sent_at", "sent_by"]);
    expect(await getLead(db, tenantId, { id })).toMatchObject({ email_status: null, result: "Replied", result_date: "2030-01-02" });
  });

  it("WhatsApp: clearing the chip empties that one cell and its buttons start over", async () => {
    const { db, tenantId, OLU, id } = await board();
    await writeLead(db, tenantId, { id }, whatsappSteps({ whatsapp: "x" })[1].fields, OLU); // Verified
    const r = await clearStatus(db, tenantId, id, "whatsapp_status", OLU);
    expect(r.ok && r.cleared).toEqual(["whatsapp_status"]);
    const after = await getLead(db, tenantId, { id });
    expect(whatsappSteps(after!).map((s) => s.label)).toEqual(["Asked to verify", "Verified"]);
  });

  it("the drawer: the header block's four fields and no separate status rows", () => {
    expect(HEADER_FIELDS).toEqual(["business", "website", "location", "industry"]);
    for (const k of [...HEADER_FIELDS, "email_status", "whatsapp_status"]) expect(DRAWER_ORDER).not.toContain(k);
    expect(DRAWER_ORDER.slice(0, 3)).toEqual(["contact_person", "contact_role", "founder_linkedin"]);
  });
});
