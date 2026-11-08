// Follow up and record the result: who is due a follow-up (own sends, 4+ working days, no result, no
// follow-up), the follow-up text (the agents' draft, else the two-line note), "Follow-up sent" as the person (an agent
// may not write it), the waiting list, and This week's count.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { followUpsDue, followUpsSince, followUpTemplate, markFollowUp, sentWaiting, workingDaysBefore } from "@/lib/follow-up";
import { getLead, historyOf, writeLead, type Actor } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";

const ENGINE: Actor = { kind: "bot", name: "Outreach Writer", via: "engine" };

describe("workingDaysBefore and the template", () => {
  it("counts Monday to Friday only", () => {
    expect(workingDaysBefore(new Date("2026-11-13T10:00:00"), 4)).toBe("2026-11-09"); // Friday -> Monday
    expect(workingDaysBefore(new Date("2026-11-10T10:00:00"), 4)).toBe("2026-11-04"); // Tuesday -> last Wednesday
  });
  it("two lines with the first name and the package, or plain", () => {
    expect(followUpTemplate({ business: "Acme Bakery", contact: "Maria Lopez", pkg: "Starter Website" })).toBe(
      "Hi Maria, a quick follow-up on my note last week about Starter Website for Acme Bakery.\nWould a 15-minute call this week be useful, or should I send the details by email?",
    );
    expect(followUpTemplate({ business: "Acme Bakery", contact: null, pkg: null }).split("\n")[0]).toBe("Hi, a quick follow-up on my note last week about the idea I sent for Acme Bakery.");
  });
});

describe("follow-ups", () => {
  it("lists my sends due, with the agents' draft when there is one; Follow-up sent moves it to waiting; This week counts it", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const make = async (business: string, extra: Record<string, unknown> = {}) => {
      const r = await writeLead(db, tenant.id, {}, { business, website: `https://${business.replace(/\W/g, "").toLowerCase()}.example`, draft_email: `Hi ${business}`, ...extra }, ENGINE, { create: true });
      if (!r.ok) throw new Error(r.message);
      return r.lead.id;
    };
    const old = await make("Old Shop", { package: "Starter Website", contact_person: "Ana Ruiz" });
    const agent = await make("Agent Shop", { draft_followup: "Hi again, a short note from the agents." });
    const fresh = await make("Fresh Shop");
    const answered = await make("Answered Shop");
    const send = (id: string, at: string) => writeLead(db, tenant.id, { id }, { email_status: "Email Sent" }, OLU, { sentAt: new Date(at) });
    await send(old, "2026-10-26T10:00:00Z");
    await send(agent, "2026-10-27T10:00:00Z");
    await send(fresh, "2026-11-06T10:00:00Z");
    await send(answered, "2026-10-26T10:00:00Z");
    await writeLead(db, tenant.id, { id: answered }, { result: "Replied", result_date: "2026-10-28" }, OLU);

    const now = new Date("2026-11-07T12:00:00"); // a Saturday: due = sent on or before Tuesday 11-03
    const due = await followUpsDue(db, tenant.id, "Olu", now);
    expect(due.map((l) => [l.business, l.followUpByAgent])).toEqual([
      ["Old Shop", false],
      ["Agent Shop", true],
    ]);
    expect(due[0].followUp).toContain("Hi Ana, a quick follow-up on my note last week about Starter Website for Old Shop.");
    expect(due[1].followUp).toBe("Hi again, a short note from the agents.");
    expect(await followUpsDue(db, tenant.id, "Sam", now)).toEqual([]); // not Sam's sends
    expect((await sentWaiting(db, tenant.id, "Olu", now)).map((l) => l.business)).toEqual(["Fresh Shop"]);

    // an agent may not record a follow-up; the person does
    const bot = await writeLead(db, tenant.id, { id: old }, { follow_up_at: "2026-11-07" }, ENGINE);
    expect(bot.ok && bot.refused.map((r) => r.reason)).toEqual(["human_only"]);
    expect(await markFollowUp(db, tenant.id, old, { userId: owner.id, name: "Olu" }, now)).toEqual({ ok: true });
    expect(await getLead(db, tenant.id, { id: old })).toMatchObject({ follow_up_at: "2026-11-07", follow_up_by: ["Olu"] });
    expect((await historyOf(db, tenant.id, old)).some((h) => h.column === "follow_up_at" && h.actor.name === "Olu")).toBe(true);
    expect((await followUpsDue(db, tenant.id, "Olu", now)).map((l) => l.business)).toEqual(["Agent Shop"]);
    expect((await sentWaiting(db, tenant.id, "Olu", now)).map((l) => l.business).sort()).toEqual(["Fresh Shop", "Old Shop"]);
    expect(Object.fromEntries(await followUpsSince(db, tenant.id, "2026-11-02"))).toEqual({ Olu: 1 });
  });

  it("refuses a follow-up on a lead that was never sent", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const r = await writeLead(db, tenant.id, {}, { business: "Unsent", website: "https://unsent.example" }, ENGINE, { create: true });
    if (!r.ok) throw new Error("setup");
    expect(await markFollowUp(db, tenant.id, r.lead.id, { userId: owner.id, name: "Olu" })).toMatchObject({ ok: false });
  });
});
