// Leads → Mark already sent: parse a paste (Sent-folder addresses, numbers, lead ids), match it to
// leads, preview what Send next stops offering, and set the chosen status as the person: a send with the paste's date,
// never moving a lead back a step.
import { describe, expect, it } from "vitest";
import { boardLite, dateOn, markOn, markSent, matchEntries, parsePaste, prevented, type LeadLite } from "@/lib/already-sent";
import { memoryDb } from "@/lib/db";
import { historyOf, writeLead, type Actor } from "@/lib/leads";
import { sendNext } from "@/lib/send-next";
import { createTenant } from "@/lib/tenants";

const lead = (id: string, o: Partial<LeadLite>): LeadLite => ({ id, business: id, businessEmail: null, domain: null, whatsapp: null, phone: null, emailStatus: null, whatsappStatus: null, hasDraft: true, ...o });

describe("parsePaste", () => {
  it("emails once each, lowercased, with the date on their line (the earliest kept)", () => {
    const e = parsePaste("To: Owner@Bakery.example, 2026-10-21\nhello@studio.example  Oct 23, 2026\nowner@bakery.example 10/19/2026\nno address here");
    expect(e.map((x) => [x.key, x.type, x.date])).toEqual([
      ["owner@bakery.example", "email", "2026-10-19"],
      ["hello@studio.example", "email", "2026-10-23"],
    ]);
  });
  it("numbers as digits, 9 to 15 of them; a date on the line is not part of a number", () => {
    expect(parsePaste("+1 (718) 555-0100  2026-10-22\n718.555.0111\n12345").map((x) => [x.key, x.type, x.date])).toEqual([
      ["17185550100", "number", "2026-10-22"],
      ["7185550111", "number", null],
    ]);
  });
  it("a line with a lead id is matched by the id, with the status it names", () => {
    const e = parsePaste('"Xianglong Li, DDS",405d905f-ccff-8119-b1ef-e8ee256ddb97,8aee3936-02ce-4080-9fa7-8c4ff030743f,Ready to Send Email');
    expect(e.map((x) => [x.key, x.type, x.mark])).toEqual([
      ["405d905fccff8119b1efe8ee256ddb97", "id", "ready_email"],
      ["8aee393602ce40809fa78c4ff030743f", "id", "ready_email"],
    ]);
  });
  it("dates and status names in the common shapes, or none", () => {
    expect(dateOn("sent 2026-10-21 09:14")).toBe("2026-10-21");
    expect(dateOn("21 Oct 2026")).toBe("2026-10-21");
    expect(dateOn("nothing")).toBeNull();
    expect(markOn("x, WhatsApp Verified")).toBe("whatsapp_verified");
    expect(markOn("x, Email Sent")).toBe("email_sent");
    expect(markOn("x, whatsapp msg sent")).toBe("whatsapp_sent");
    expect(markOn("x")).toBeNull();
  });
});

describe("matchEntries", () => {
  const board = [
    lead("bakery", { businessEmail: "owner@bakery.example", domain: "bakery.example" }),
    lead("studio", { domain: "studio.example" }),
    lead("chain-1", { domain: "chain.example" }),
    lead("chain-2", { domain: "chain.example" }),
    lead("gmail-shop", { businessEmail: "shop@gmail.com", domain: null }),
    lead("sent", { businessEmail: "done@sent.example", emailStatus: "Email Sent" }),
    lead("wa", { whatsapp: "https://wa.me/17185550100", phone: "+17185550199", whatsappStatus: "WhatsApp msg sent" }),
    lead("8aee3936-02ce-4080-9fa7-8c4ff030743f", { business: "By id", notionPageId: "405d905f-ccff-8119-b1ef-e8ee256ddb97" }),
  ];
  it("exact email, then the domain; never a free-mail domain; several leads: listed, not marked", () => {
    const p = matchEntries(parsePaste("owner@bakery.example\nnew@studio.example\nx@chain.example\nother@gmail.com\nshop@gmail.com\ndone@sent.example\nnobody@nowhere.example"), board, "email_sent");
    expect(p.matched.map((m) => [m.leadId, m.by, m.already])).toEqual([
      ["bakery", "email", false],
      ["studio", "domain", false],
      ["gmail-shop", "email", false],
      ["sent", "email", true],
    ]);
    expect(p.ambiguous).toEqual([{ key: "x@chain.example", leads: 2 }]);
    expect(p.notFound).toEqual(["other@gmail.com", "nobody@nowhere.example"]);
  });
  it("a number with or without its country code; a lead id, the portal's or Notion's", () => {
    expect(matchEntries(parsePaste("7185550100"), board, "whatsapp_sent").matched.map((m) => [m.leadId, m.already])).toEqual([["wa", true]]);
    expect(matchEntries(parsePaste("+44 20 7946 0000"), board, "whatsapp_sent").notFound).toEqual(["442079460000"]);
    expect(matchEntries(parsePaste("405d905f-ccff-8119-b1ef-e8ee256ddb97"), board, "ready_email").matched.map((m) => [m.business, m.by, m.mark])).toEqual([["By id", "id", "ready_email"]]);
  });
  it("never moves a lead back a step: Verified after a WhatsApp sent, Ready after Email Sent", () => {
    expect(matchEntries(parsePaste("7185550100"), board, "whatsapp_verified").matched[0].already).toBe(true);
    expect(matchEntries(parsePaste("done@sent.example"), board, "ready_email").matched[0].already).toBe(true);
    expect(matchEntries(parsePaste("owner@bakery.example"), board, "ready_email").matched[0].already).toBe(false);
  });
  it("as each line says: the line's status; a line that names none is listed", () => {
    const p = matchEntries(parsePaste("owner@bakery.example, Email Sent\nnew@studio.example, WhatsApp Verified\nshop@gmail.com"), board, "per_line");
    expect(p.matched.map((m) => [m.leadId, m.mark])).toEqual([
      ["bakery", "email_sent"],
      ["studio", "whatsapp_verified"],
    ]);
    expect(p.noMark).toEqual(["shop@gmail.com"]);
  });
  it("what marking prevents counts the Email sent marks: offered by Send next now, and drafts waiting", () => {
    const p = matchEntries(parsePaste("owner@bakery.example\nnew@studio.example\ndone@sent.example"), [board[0], { ...board[1], hasDraft: false }, board[5]], "email_sent");
    expect(prevented(p, ["bakery"])).toEqual({ now: 1, later: 0 });
    expect(prevented(p, [])).toEqual({ now: 0, later: 1 });
    expect(prevented(matchEntries(parsePaste("owner@bakery.example"), board, "ready_email"), ["bakery"])).toEqual({ now: 0, later: 0 });
  });
});

describe("markSent", () => {
  it("sets the status as the person: a send with the paste's date and Sent by, in History; Send next stops offering it", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ENGINE: Actor = { kind: "bot", name: "Outreach Writer", via: "engine" };
    const a = await writeLead(db, tenant.id, {}, { business: "Acme Bakery", website: "https://acmebakery.example", business_email: "hello@acmebakery.example", draft_email: "Hi" }, ENGINE, { create: true });
    const b = await writeLead(db, tenant.id, {}, { business: "Bravo Barbers", website: "https://bravo.example", business_email: "hi@bravo.example", draft_email: "Hello", whatsapp: "https://wa.me/17185550100" }, ENGINE, { create: true });
    if (!a.ok || !b.ok) throw new Error("setup");
    expect((await sendNext(db, tenant.id)).rows.map((r) => r.business).sort()).toEqual(["Acme Bakery", "Bravo Barbers"]);

    const p = matchEntries(parsePaste("hello@acmebakery.example 2026-10-21"), await boardLite(db, tenant.id), "email_sent");
    expect(prevented(p, (await sendNext(db, tenant.id)).rows.map((r) => r.id))).toEqual({ now: 1, later: 0 });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    expect(await markSent(db, tenant.id, p, OLU)).toEqual({ marked: 1, failed: [] });

    const after = await boardLite(db, tenant.id);
    expect(after.find((l) => l.id === a.lead.id)?.emailStatus).toBe("Email Sent");
    const hist = await historyOf(db, tenant.id, a.lead.id);
    expect(hist.filter((h) => h.actor.name === "Olu").map((h) => h.column)).toEqual(expect.arrayContaining(["email_status", "sent_at", "sent_by"]));
    expect(JSON.stringify(hist.find((h) => h.column === "sent_at")?.new)).toContain("2026-10-21");
    expect((await sendNext(db, tenant.id)).rows.map((r) => r.business)).toEqual(["Bravo Barbers"]);
    // again: already marked, nothing written
    const again = matchEntries(parsePaste("hello@acmebakery.example"), await boardLite(db, tenant.id), "email_sent");
    expect(again.matched[0].already).toBe(true);
    expect(await markSent(db, tenant.id, again, OLU)).toEqual({ marked: 0, failed: [] });

    // a flag only a person may set (the Validator's refused list), by lead id: no send, no Sent at
    const v = matchEntries(parsePaste(`Bravo Barbers,${b.lead.id},WhatsApp Verified`), await boardLite(db, tenant.id), "per_line");
    expect(await markSent(db, tenant.id, v, OLU)).toEqual({ marked: 1, failed: [] });
    const bravo = (await boardLite(db, tenant.id)).find((l) => l.id === b.lead.id)!;
    expect(bravo.whatsappStatus).toBe("WhatsApp Verified");
    expect((await historyOf(db, tenant.id, b.lead.id)).some((h) => h.column === "sent_at")).toBe(false);
  });
});
