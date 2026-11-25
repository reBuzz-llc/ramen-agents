// Daily send goals per person: 5 emails and 3 WhatsApp messages a day unless the
// owner sets others. A goal is a target, not a limit: the pack fills to ten all day and
// no send is refused for the count. Mark already sent never counts; an undo takes a send off the day.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { boardLite, markSent, matchEntries, parsePaste } from "@/lib/already-sent";
import { memoryDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { writeLead, WHATSAPP_SENT, type Actor } from "@/lib/leads";
import {
  dayIn,
  dayStartIn,
  DEFAULT_EMAIL_GOAL,
  DEFAULT_WHATSAPP_GOAL,
  doneLine,
  goalFromForm,
  goalLine,
  goalsChanged,
  goalsOf,
  sendsIn,
  validTimeZone,
  workingDaysSoFar,
} from "@/lib/send-goals";
import { todayOf } from "@/lib/send-goals-db";
import { fillPack, markPackSent, packOf } from "@/lib/send-pack";
import { createTenant } from "@/lib/tenants";
import { CHECK, fillChecks, markWhatsappSent, sendList, setCheck } from "@/lib/whatsapp-pack";
import { saveBoardAsList } from "./helpers/saved-send-list";

const ENGINE: Actor = { kind: "bot", name: "Outreach Writer", via: "engine" };

async function board(n: number) {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await writeLead(
      db,
      tenant.id,
      {},
      { business: `Shop ${String(i).padStart(2, "0")}`, website: `https://shop${i}.example`, business_email: `hi@shop${i}.example`, whatsapp: `https://wa.me/1718555${1000 + i}`, draft_email: `Hi ${i}`, draft_whatsapp: `Hello ${i}`, lead_score: 100 - i },
      ENGINE,
      { create: true },
    );
    if (!r.ok) throw new Error(r.message);
    ids.push(r.lead.id);
  }
  const OLU = { userId: owner.id, name: "Olu" };
  const person: Actor = { kind: "person", name: "Olu", userId: owner.id };
  await saveBoardAsList(db, tenant.id);
  return { db, tenantId: tenant.id, owner, ids, OLU, person };
}

describe("goals and the company's day", () => {
  it("defaults to 5 and 3; the owner's whole numbers win; the form takes 0-200 only", () => {
    expect(goalsOf({})).toEqual({ email: DEFAULT_EMAIL_GOAL, whatsapp: DEFAULT_WHATSAPP_GOAL });
    expect(goalsOf({ sendGoals: { email: 8, whatsapp: 0 } })).toEqual({ email: 8, whatsapp: 0 });
    expect(goalsOf({ sendGoals: { email: -1, whatsapp: 2.5 } })).toEqual({ email: 5, whatsapp: 3 });
    expect(goalFromForm("7")).toBe(7);
    expect(goalFromForm("")).toBeUndefined();
    expect(goalFromForm("1.5")).toBeUndefined();
    expect(goalFromForm("999")).toBeUndefined();
    expect(doneLine(5)).toBe("Today's goal of 5 is met. Keep going!");
    expect(doneLine(1)).toBe("Today's goal of 1 is met. Keep going!");
  });

  it("starts the day at midnight in the company's time zone", () => {
    expect(validTimeZone("Europe/Berlin")).toBe(true);
    expect(validTimeZone("Mars/Base")).toBe(false);
    const late = new Date("2026-11-09T23:30:00Z"); // already the 10th in Berlin (UTC+1)
    expect(dayIn(late, "Europe/Berlin")).toBe("2026-11-10");
    expect(dayStartIn(late, "Europe/Berlin").toISOString()).toBe("2026-11-09T23:00:00.000Z");
    expect(dayStartIn(new Date("2026-11-09T03:00:00Z"), "America/New_York").toISOString()).toBe("2026-11-08T05:00:00.000Z");
    // a summer day keeps its own offset
    expect(dayStartIn(new Date("2026-07-01T12:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(dayStartIn(new Date("2026-11-09T10:00:00Z"), "UTC").toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("counts working days so far; finds the sends in an edit", () => {
    expect(workingDaysSoFar(new Date(2026, 10, 9), new Date(2026, 10, 11, 15))).toBe(3); // Mon to Wed
    expect(workingDaysSoFar(new Date(2026, 10, 9), new Date(2026, 10, 15, 15))).toBe(5); // the weekend adds none
    expect(sendsIn({ email_status: "Email Sent", result: "Emailed" })).toEqual(["email"]);
    expect(sendsIn({ whatsapp_status: WHATSAPP_SENT })).toEqual(["whatsapp"]);
    expect(sendsIn({ email_status: "Ready to Send Email", whatsapp_status: "WhatsApp Verified" })).toEqual([]);
  });
});

describe("the daily goal is a target, not a limit", () => {
  it("the pack fills ten; past the goal Mark sent goes on and the pack refills", async () => {
    const { db, tenantId, owner, OLU } = await board(20);
    expect(await fillPack(db, tenantId, owner.id)).toBe(10);
    for (const l of (await packOf(db, tenantId, owner.id)).slice(0, 7)) expect((await markPackSent(db, tenantId, l.id, OLU)).ok).toBe(true);
    expect((await todayOf(db, tenantId, owner.id)).email).toEqual({ sent: 7, goal: 5, left: 0 });
    expect(await packOf(db, tenantId, owner.id)).toHaveLength(10); // topped up after each send
    // a lead taken by hand (Send next → Take it) is marked sent too
    const { accept } = await import("@/lib/claims");
    const spare = (await db.query.leads.findMany()).find((l) => !l.emailStatus)!;
    await accept(db, tenantId, spare.id, owner.id);
    expect((await markPackSent(db, tenantId, spare.id, OLU)).ok).toBe(true);
    expect((await todayOf(db, tenantId, owner.id)).email.sent).toBe(8);
  });

  it("an undo frees the slot; the owner's goal applies at once", async () => {
    const { db, tenantId, owner, ids, person } = await board(8);
    for (const id of ids.slice(0, 5)) expect((await writeLead(db, tenantId, { id }, { email_status: "Email Sent" }, person)).ok).toBe(true);
    expect((await todayOf(db, tenantId, owner.id)).email.left).toBe(0);
    await writeLead(db, tenantId, { id: ids[0] }, { email_status: null }, person); // pressed by mistake: the × on the chip
    expect((await todayOf(db, tenantId, owner.id)).email).toEqual({ sent: 4, goal: 5, left: 1 });
    await db.update(tenants).set({ settings: { sendGoals: { email: 6 } } }).where(eq(tenants.id, tenantId));
    expect((await todayOf(db, tenantId, owner.id)).email).toEqual({ sent: 4, goal: 6, left: 2 });
  });

  it("Mark already sent (sends made before) never counts toward today", async () => {
    const { db, tenantId, owner, person } = await board(10);
    const paste = parsePaste(["hi@shop1.example", "hi@shop2.example", "hi@shop3.example", "hi@shop4.example", "hi@shop5.example", "hi@shop6.example"].join("\n"));
    const preview = matchEntries(paste, await boardLite(db, tenantId), "email_sent");
    expect((await markSent(db, tenantId, preview, person)).marked).toBe(6);
    expect((await todayOf(db, tenantId, owner.id)).email).toEqual({ sent: 0, goal: 5, left: 5 });
  });

  it("WhatsApp: the list shows up to ten whatever was sent today; past the goal it goes on", async () => {
    const { db, tenantId, owner, ids, OLU } = await board(30);
    expect(await fillChecks(db, tenantId, owner.id)).toBe(CHECK);
    for (const id of ids.slice(0, 6)) expect((await setCheck(db, tenantId, id, "verified", OLU)).ok).toBe(true);
    const list = await sendList(db, tenantId, owner.id);
    expect(list).toHaveLength(6);
    for (const l of list.slice(0, 5)) expect((await markWhatsappSent(db, tenantId, l.id, OLU)).ok).toBe(true);
    expect((await todayOf(db, tenantId, owner.id)).whatsapp).toEqual({ sent: 5, goal: 3, left: 0 });
    expect(await sendList(db, tenantId, owner.id)).toHaveLength(1);
    // emails are a separate count
    expect((await todayOf(db, tenantId, owner.id)).email.left).toBe(5);
  });

  it("no route refuses a send for the count", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["app/api/leads/[id]/route.ts", "app/api/queue/route.ts", "lib/send-pack.ts", "lib/whatsapp-pack.ts", "lib/send-goals-db.ts"]) expect(readFileSync(`${process.cwd()}/${f}`, "utf8")).not.toContain("overGoal");
  });
});

describe("the goal line and the change banner", () => {
  it("says the live goals in one line", () => {
    expect(goalLine(goalsOf({}))).toBe("Your daily goal: 5 emails and 3 WhatsApp messages, set by the owner. It is a target, not a limit.");
    expect(goalLine(goalsOf({ sendGoals: { email: 1, whatsapp: 1 } }))).toBe("Your daily goal: 1 email and 1 WhatsApp message, set by the owner. It is a target, not a limit.");
  });
  it("shows a change once per person, until they dismiss that change", () => {
    const s = { sendGoals: { email: 8, whatsapp: 2, changedAt: "2026-11-09T12:00:00.000Z" } };
    expect(goalsChanged({}, null)).toBeNull();
    expect(goalsChanged(s, null)).toEqual({ at: "2026-11-09T12:00:00.000Z", text: "The owner changed the daily goals to 8 emails and 2 WhatsApp messages." });
    expect(goalsChanged(s, "2026-11-09T12:00:00.000Z")).toBeNull();
    expect(goalsChanged({ sendGoals: { ...s.sendGoals, changedAt: "2026-11-10T08:00:00.000Z" } }, "2026-11-09T12:00:00.000Z")?.at).toBe("2026-11-10T08:00:00.000Z");
  });
});
