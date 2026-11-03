import { describe, expect, it } from "vitest";
import { accept } from "@/lib/claims";
import { memoryDb } from "@/lib/db";
import { emailSteps, tone, whatsappSteps } from "@/lib/lead-workflow";
import { boardOf, historyOf, writeLead, type Actor } from "@/lib/leads";
import { saveList, sendNext } from "@/lib/send-next";
import { addUser, createTenant } from "@/lib/tenants";

const NOW = new Date("2026-11-02T10:00:00Z");
const BOT: Actor = { kind: "bot", name: "Lead Enricher", via: "engine" };

async function board() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const ann = await addUser(db, tenant.id, "ann@acme.example", "Ann");
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const ANN: Actor = { kind: "person", name: "Ann", userId: ann.id };
  const make = async (business: string, fields: Record<string, unknown> = {}, page?: string) => {
    const r = await writeLead(db, tenant.id, { notionPageId: page }, { business, website: `https://${business.split(" ")[0].toLowerCase()}.example`, ...fields }, { kind: "bot", name: "backfill", via: "backfill" }, { create: true, import: true });
    if (!r.ok) throw new Error(r.message);
    return r.lead.id;
  };
  return { db, tenantId: tenant.id, owner, ann, OLU, ANN, make };
}

describe("the status workflow", () => {
  it("email: New → Ready to send → Email sent → Replied / Meeting / Won / Lost, then nothing", () => {
    const keys = (l: Record<string, unknown>) => emailSteps(l, NOW).map((s) => s.label);
    expect(keys({})).toEqual(["Ready to send"]);
    expect(keys({ email_status: "Ready to Send Email" })).toEqual(["Mark email sent"]);
    expect(emailSteps({ email_status: "Ready to Send Email" }, NOW)[0].fields).toEqual({ email_status: "Email Sent", result: "Emailed", result_date: "2026-11-02" });
    expect(keys({ email_status: "Email Sent", result: "Emailed" })).toEqual(["Replied", "Won", "Lost", "Bounced"]);
    expect(keys({ email_status: "Email Sent", result: "Replied" })).toEqual(["Meeting booked", "Won", "Lost"]);
    expect(keys({ email_status: "Email Sent", result: "Meeting" })).toEqual(["Won", "Lost"]);
    expect(emailSteps({ email_status: "Email Sent", result: "Meeting" }, NOW)[0].fields).toEqual({ result: "Client", result_date: "2026-11-02" });
    for (const done of ["Client", "Not interested", "Bounced"]) expect(keys({ email_status: "Email Sent", result: done })).toEqual([]);
  });

  it("WhatsApp: only with a link; asked → verified or false → message sent", () => {
    const keys = (l: Record<string, unknown>) => whatsappSteps(l).map((s) => s.label);
    expect(keys({})).toEqual([]);
    const wa = "https://wa.me/17185550100";
    expect(keys({ whatsapp: wa })).toEqual(["Asked to verify", "Verified"]);
    expect(keys({ whatsapp: wa, whatsapp_status: "Waiting response for WhatsApp verification" })).toEqual(["Verified", "False number"]);
    expect(keys({ whatsapp: wa, whatsapp_status: "WhatsApp Verified" })).toEqual(["WhatsApp message sent"]);
    expect(keys({ whatsapp: wa, whatsapp_status: "False Whatsapp Number" })).toEqual([]);
    expect([tone("Client"), tone("False Whatsapp Number"), tone("Email Sent"), tone("Ready to Send Email"), tone(null)]).toEqual(["good", "bad", "go", "wait", "none"]);
  });

  it("a person's one-click steps and edits are written as that person; Email Sent fills sent by and sent at", async () => {
    const { db, tenantId, ANN, make } = await board();
    const id = await make("Bravo Barbers", { draft_email: "Hi" });
    for (const s of [emailSteps({}, NOW)[0], emailSteps({ email_status: "Ready to Send Email" }, NOW)[0]]) expect((await writeLead(db, tenantId, { id }, s.fields, ANN)).ok).toBe(true);
    const r = await writeLead(db, tenantId, { id }, { contact_role: "Owner" }, ANN);
    expect(r.ok && r.lead).toMatchObject({ email_status: "Email Sent", result: "Emailed", sent_by: ["Ann"], contact_role: "Owner" });
    expect(r.ok && r.lead.sent_at).toBeTruthy();
    const h = await historyOf(db, tenantId, id);
    const mine = h.filter((x) => x.actor.name === "Ann");
    expect(mine.map((x) => x.column).sort()).toEqual(["contact_role", "email_status", "email_status", "result", "result_date", "sent_at", "sent_by"].sort());
    expect(mine.every((x) => x.actor.kind === "person" && x.outcome === "applied")).toBe(true);
    // the bots' rule is unchanged: a bot still cannot touch the team's fields, nor a cell a person set last
    const bot = await writeLead(db, tenantId, { id }, { result: "Client", email_status: null, contact_role: "Founder" }, BOT);
    expect(bot.ok && bot.refused.map((x) => [x.field, x.reason]).sort()).toEqual([
      ["contact_role", "person_wins"],
      ["email_status", "human_only"],
      ["result", "human_only"],
    ]);
  });
});

describe("the board's Mine and Corrected filters", () => {
  it("Mine: taken by me or changed by me; Corrected: a person changed a cell a bot had set", async () => {
    const { db, tenantId, owner, ann, OLU, make } = await board();
    const a = await make("Acme Bakery");
    const b = await make("Bravo Barbers");
    const c = await make("Cedar Clinic");
    await writeLead(db, tenantId, { id: a }, { industry: "Bakery" }, BOT);
    await writeLead(db, tenantId, { id: a }, { industry: "Bakery and cafe" }, OLU); // corrects the bot
    await writeLead(db, tenantId, { id: b }, { size: "5-10" }, OLU); // fills an empty cell: not a correction
    await accept(db, tenantId, c, ann.id);
    const rows = await boardOf(db, tenantId, owner.id);
    const flags = Object.fromEntries(rows.map((r) => [r.business, [!!r.mine, !!r.corrected, r.takenBy]]));
    expect(flags).toEqual({ "Acme Bakery": [true, true, null], "Bravo Barbers": [true, false, null], "Cedar Clinic": [false, false, "Ann"] });
    const asAnn = await boardOf(db, tenantId, ann.id);
    expect(asAnn.filter((r) => r.mine).map((r) => r.business)).toEqual(["Cedar Clinic"]);
  });
});

describe("send next", () => {
  it("shows the Validator's pushed list in its order, by Notion page id; drops what was sent since; counts what the board lacks", async () => {
    const { db, tenantId, ANN, make } = await board();
    const p1 = "00000000000040008000000000000304";
    const p2 = "00000000000040008000000000000305";
    const x = await make("Mokbar Kitchen", { draft_email: "Hi Esther", business_email: "pr@mokbar.example", lead_score: 49 }, p1);
    const y = await make("Kline Studio", { draft_email: "Hi" }, p2);
    await saveList(db, tenantId, "send-next", { generated_at: "2026-11-02T02:31:45", next: [{ id: p2 }, { id: p1, note: "chain" }, { id: "f".repeat(32) }], held: [{ id: "x", name: "Echo Eatery", reason: "greeting is a placeholder" }] }, "validator");
    let s = await sendNext(db, tenantId);
    expect(s).toMatchObject({ source: "validator", generatedAt: "2026-11-02T02:31:45", missing: 1, held: [{ business: "Echo Eatery", reason: "greeting is a placeholder" }] });
    expect(s.rows.map((r) => [r.business, r.note])).toEqual([
      ["Kline Studio", ""],
      ["Mokbar Kitchen", "chain"],
    ]);
    expect(s.rows[1]).toMatchObject({ email: "pr@mokbar.example", draft: "Hi Esther", score: 49, takenBy: null });
    await writeLead(db, tenantId, { id: y }, { email_status: "Email Sent" }, ANN);
    s = await sendNext(db, tenantId);
    expect(s.rows.map((r) => r.id)).toEqual([x]);
  });

  it("with no list: the board's own rule (a draft not 'skip:', not sent, no result), best score first", async () => {
    const { db, tenantId, make } = await board();
    await make("Low Score Co", { draft_email: "Hi", lead_score: 40 });
    await make("High Score Co", { draft_email: "Hi", lead_score: 90 });
    await make("Skipped Co", { draft_email: "skip: chain", lead_score: 95 });
    await make("Sent Co", { draft_email: "Hi", lead_score: 99, status: ["Email Sent"] });
    await make("No Draft Co", { lead_score: 99 });
    const s = await sendNext(db, tenantId);
    expect(s.source).toBe("board");
    expect(s.rows.map((r) => r.business)).toEqual(["High Score Co", "Low Score Co"]);
  });
});
