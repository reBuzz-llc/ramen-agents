// Follow up and record the result (the Follow up tab and its agreed draft shape):
// steps at 2, 5 and 14 days with no reply, at most three, a draft per step stamped by Peek, no generic template, a person's
// step safe from a bot, a day's count that never blocks. Invented people and businesses.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dayLine } from "@/app/leads/follow-up-view";
import { GET as plan } from "@/app/v1/follow-ups/route";
import { PATCH as writeRow } from "@/app/v1/rows/[id]/route";
import { mintKey } from "@/lib/api-keys";
import { memoryDb, type Db } from "@/lib/db";
import { leadFlags, leadFollowUps, leads, samples } from "@/lib/db/schema";
import { followUpCount, followUpPlan, followUpsDue, followUpsSince, markFollowUp, sentWaiting } from "@/lib/follow-up";
import { draftHold, mergeDrafts, nextStep, NO_SAMPLE_LINE, readStepInput, SAYS_BUILT_LINE, type StepInput, type StepKey } from "@/lib/follow-up-drafts";
import { getLead, historyOf, writeLead, type Actor } from "@/lib/leads";
import { todayOf } from "@/lib/send-goals-db";
import { addUser, createTenant } from "@/lib/tenants";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async (real) => ({ ...(await real<typeof import("@/lib/db")>()), db: async () => h.db }));

const ENGINE: Actor = { kind: "bot", name: "Outreach Writer", via: "engine" };
const DAY = 86_400_000;
const SENT = new Date("2026-11-02T10:00:00Z");
const after = (days: number, hours = 1) => new Date(SENT.getTime() + days * DAY + hours * 3_600_000);
const steps = (o: Record<string, StepInput>) => new Map(Object.entries(o)) as Map<StepKey, StepInput>;

let db: Db;
let t: string;
let ownerId: string;
let OLU: Actor;
const olu = () => ({ userId: ownerId, name: "Olu" });
async function sent(business: string, extra: Record<string, unknown> = {}, by: Actor = OLU, at = SENT) {
  const r = await writeLead(db, t, {}, { business, website: `https://${business.replace(/\W/g, "").toLowerCase()}.example`, draft_email: `Hi ${business}`, ...extra }, ENGINE, { create: true });
  if (!r.ok) throw new Error(r.message);
  await writeLead(db, t, { id: r.lead.id }, { email_status: "Email Sent", result: "Emailed", result_date: "2026-11-02" }, by, { sentAt: at });
  return String(r.lead.id);
}
const names = async (who: string | null, now: Date) => (await followUpsDue(db, t, who, now)).map((l) => l.business);

beforeEach(async () => {
  db = await memoryDb();
  h.db = db;
  const made = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  t = made.tenant.id;
  ownerId = made.owner.id;
  OLU = { kind: "person", name: "Olu", userId: ownerId };
});

describe("the steps", () => {
  it("come at 2, 5 and 14 days, and stop after the third", () => {
    expect(nextStep(SENT, [])).toEqual({ step: 1, dueAt: new Date(SENT.getTime() + 2 * DAY) });
    const one = { step: 1, sentAt: after(2) };
    expect(nextStep(SENT, [one])).toEqual({ step: 2, dueAt: new Date(SENT.getTime() + 5 * DAY) });
    const two = { step: 2, sentAt: after(5) };
    expect(nextStep(SENT, [one, two])).toEqual({ step: 3, dueAt: new Date(SENT.getTime() + 14 * DAY) });
    expect(nextStep(SENT, [one, two, { step: 3, sentAt: after(14) }])).toBeNull();
  });

  it("never puts two follow-ups within two days when one was marked late", () => {
    const late = after(5, 0);
    expect(nextStep(SENT, [{ step: 1, sentAt: late }])?.dueAt).toEqual(new Date(late.getTime() + 2 * DAY));
  });
});

describe("a step's draft", () => {
  it("takes text with a channel, or a skip", () => {
    expect(readStepInput({ "1": { text: " Hi ", channel: "email" }, "3": { skip: " no " } })).toMatchObject({ ok: true });
    for (const bad of [null, [], "x", {}, { "4": { text: "x", channel: "email" } }, { "1": "x" }, { "1": { text: "x" } }, { "1": { text: "x", channel: "fax" } }, { "1": { text: " ", channel: "email" } }, { "1": { skip: "" } }, { "1": { text: "x", channel: "email", skip: "y" } }, { "1": { text: "skip: not this one", channel: "email" } }, { "1": { text: "x".repeat(4001), channel: "email" } }])
      expect(readStepInput(bad).ok).toBe(false);
  });

  it("is stamped here, whatever the request says", () => {
    const r = readStepInput({ "1": { text: "Hi", channel: "email", by: "person", at: "1999-01-01" } });
    if (!r.ok) throw new Error(r.message);
    const now = new Date("2026-11-05T00:00:00Z");
    expect(mergeDrafts(null, r.steps, "bot", now).next["1"]).toEqual({ text: "Hi", channel: "email", by: "bot", at: now.toISOString() });
  });

  it("a bot may not overwrite a person's step, and its other steps still apply", () => {
    const now = new Date();
    const mine = mergeDrafts(null, steps({ "1": { text: "Mine", channel: "email" } }), "person", now).next;
    const m = mergeDrafts(mine, steps({ "1": { text: "Bot", channel: "email" }, "2": { text: "Bot two", channel: "email" } }), "bot", now);
    expect(m.refused).toEqual(["1"]);
    expect(m.written).toEqual(["2"]);
    expect(m.next["1"]).toMatchObject({ text: "Mine", by: "person" });
  });

  it("is held when it claims a site we have not made or links to a sample that is not live", () => {
    const none = { approved: false, liveUrl: "" };
    const live = { approved: true, liveUrl: "https://acme-samples.pages.dev/gamma-grill/" };
    for (const s of ["We have created a website for your business.", "we've built a new site for you", "We just designed your website", "Here is what we've made"]) {
      expect(draftHold(s, none)).toBe(SAYS_BUILT_LINE);
      expect(draftHold(s, live)).toBe("");
    }
    for (const s of ["We'd like to build you a website for free.", "Would a website help?", "We made a note of it."]) expect(draftHold(s, none)).toBe("");
    expect(draftHold("See https://acme-samples.pages.dev/gamma-grill/", none)).toBe(NO_SAMPLE_LINE);
    expect(draftHold("See https://acme-samples.pages.dev/other-shop/.", live)).toBe(NO_SAMPLE_LINE);
    expect(draftHold("See https://acme-samples.pages.dev/gamma-grill.", live)).toBe("");
  });
});

describe("the list", () => {
  it("counts a send with Result empty or Emailed from day 2, and says no draft yet instead of a template", async () => {
    await sent("Emailed Shop");
    const empty = await writeLead(db, t, {}, { business: "Empty Shop", website: "https://emptyshop.example" }, ENGINE, { create: true });
    if (!empty.ok) throw new Error("setup");
    await writeLead(db, t, { id: empty.lead.id }, { email_status: "Email Sent" }, OLU, { sentAt: SENT });
    expect(await names("Olu", after(1))).toEqual([]);
    const due = await followUpsDue(db, t, "Olu", after(2));
    expect(due.map((l) => l.business).sort()).toEqual(["Emailed Shop", "Empty Shop"]);
    expect(due[0]).toMatchObject({ step: 1, channel: "email", followUp: "", followUpBy: null, hold: "" });
    expect(await followUpCount(db, t, "Olu", after(2))).toBe(2);
  });

  it("leaves off a lead with an answer, on hold, or with a skip for its step", async () => {
    await sent("Waiting Shop");
    for (const result of ["Replied", "Meeting", "Client", "Not interested", "Bounced"]) {
      const id = await sent(`${result} Shop`);
      await writeLead(db, t, { id }, { result, result_date: "2026-11-03" }, OLU);
    }
    const held = await sent("Held Shop");
    await db.insert(leadFlags).values({ tenantId: t, leadId: held, rule: "OW27", detail: "x" });
    await sent("Skip Shop", { followup_drafts: { "1": { skip: "asked us to stop" } } });
    await sent("Old Skip Shop", { draft_followup: "skip: no good reason to write" });
    expect(await names("Olu", after(3))).toEqual(["Waiting Shop"]);
    expect((await followUpPlan(db, t, after(3))).map((r) => r.draft).sort()).toEqual(["none", "skip", "skip"]);
  });

  it("is own sends by default, everyone's with no name", async () => {
    const sam = await addUser(db, t, "sam@acme.example", "Sam");
    await sent("Olu Shop");
    await sent("Sam Shop", {}, { kind: "person", name: "Sam", userId: sam.id });
    expect(await names("Olu", after(3))).toEqual(["Olu Shop"]);
    expect(await names("Sam", after(3))).toEqual(["Sam Shop"]);
    expect((await names(null, after(3))).sort()).toEqual(["Olu Shop", "Sam Shop"]);
  });

  it("shows the step's own draft, and holds one that claims a site with no approved sample", async () => {
    const good = await sent("Good Shop", { followup_drafts: { "1": { text: "A short note.", channel: "whatsapp" }, "2": { text: "The second note.", channel: "email" } } });
    await sent("Claim Shop", { followup_drafts: { "1": { text: "We have created a website for you.", channel: "email" } } });
    const due = await followUpsDue(db, t, "Olu", after(3));
    expect(due.find((l) => l.business === "Good Shop")).toMatchObject({ followUp: "A short note.", channel: "whatsapp", followUpBy: "bot", hold: "" });
    expect(due.find((l) => l.business === "Claim Shop")).toMatchObject({ hold: SAYS_BUILT_LINE });
    await markFollowUp(db, t, good, olu(), after(3));
    expect((await followUpsDue(db, t, "Olu", after(6))).find((l) => l.business === "Good Shop")).toMatchObject({ step: 2, followUp: "The second note.", channel: "email" });
  });

  it("treats a live sample's own address as fine and an approved sample as making the claim true", async () => {
    const id = await sent("Live Shop", { followup_drafts: { "1": { text: "We have created a website: https://acme-samples.pages.dev/live-shop/", channel: "email" } } });
    await db.insert(samples).values({ tenantId: t, leadId: id, slug: "live-shop", template: "eat", status: "live", url: "https://acme-samples.pages.dev/live-shop/" });
    expect((await followUpsDue(db, t, "Olu", after(3)))[0]).toMatchObject({ hold: "" });
  });
});

describe("Mark sent", () => {
  it("records each step as the person, up to three, and keeps History, This week and the waiting list", async () => {
    const id = await sent("Old Shop");
    expect(await markFollowUp(db, t, id, olu(), after(2), { step: 1 })).toEqual({ ok: true, step: 1 });
    expect(await getLead(db, t, { id })).toMatchObject({ follow_up_by: ["Olu"] });
    expect((await historyOf(db, t, id)).some((x) => x.column === "follow_up_at" && x.actor.name === "Olu")).toBe(true);
    expect(await names("Olu", after(3))).toEqual([]);
    expect((await sentWaiting(db, t, "Olu", after(3))).map((l) => l.business)).toEqual(["Old Shop"]);
    expect(await names("Olu", after(5))).toEqual(["Old Shop"]);
    expect(await markFollowUp(db, t, id, olu(), after(5), { step: 2 })).toMatchObject({ ok: true, step: 2 });
    expect(await markFollowUp(db, t, id, olu(), after(14), { step: 3 })).toMatchObject({ ok: true, step: 3 });
    expect(await markFollowUp(db, t, id, olu(), after(15))).toEqual({ ok: false, error: "This lead already has its three follow-ups." });
    expect(await names("Olu", after(40))).toEqual([]);
    expect(Object.fromEntries(await followUpsSince(db, t, "2026-11-01"))).toEqual({ Olu: 3 });
  });

  it("refuses a step already recorded, so a double press counts once", async () => {
    const id = await sent("Twice Shop");
    await markFollowUp(db, t, id, olu(), after(2), { step: 1 });
    expect(await markFollowUp(db, t, id, olu(), after(2), { step: 1 })).toMatchObject({ ok: false });
    expect(await db.select().from(leadFollowUps).where(eq(leadFollowUps.leadId, id))).toHaveLength(1);
  });

  it("refuses a lead that was never sent, and a bot may not write the follow-up cells", async () => {
    const r = await writeLead(db, t, {}, { business: "Unsent", website: "https://unsent.example" }, ENGINE, { create: true });
    if (!r.ok) throw new Error("setup");
    expect(await markFollowUp(db, t, String(r.lead.id), olu())).toMatchObject({ ok: false });
    const bot = await writeLead(db, t, { id: r.lead.id }, { follow_up_at: "2026-11-07" }, ENGINE);
    expect(bot.ok && bot.refused.map((x) => x.reason)).toEqual(["human_only"]);
  });

  it("counts in the day's numbers on its own channel and never blocks past the goal", async () => {
    const now = new Date();
    const at = new Date(now.getTime() - 3 * DAY);
    const ids = [await sent("A Shop", {}, OLU, at), await sent("B Shop", { followup_drafts: { "1": { text: "Hi", channel: "whatsapp" } } }, OLU, at)];
    const before = await todayOf(db, t, ownerId, now);
    for (const id of ids) expect(await markFollowUp(db, t, id, olu(), now)).toMatchObject({ ok: true });
    const later = await todayOf(db, t, ownerId, now);
    expect(later.email.sent).toBe(before.email.sent + 1);
    expect(later.whatsapp.sent).toBe(before.whatsapp.sent + 1);
    expect(dayLine({ email: { sent: 10, goal: 10, left: 0 }, whatsapp: { sent: 1, goal: 3, left: 2 } })).toEqual({ reached: true, text: "Today's count is reached: 10 of 10 emails. Mark sent still records what you sent." });
    expect(dayLine({ email: { sent: 2, goal: 10, left: 8 }, whatsapp: { sent: 1, goal: 3, left: 2 } }).reached).toBe(false);
  });
});

describe("the engine's routes (818)", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const write = (id: string, token: string, fields: object) => writeRow(new Request(`http://peek.test/v1/rows/${id}`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ fields }) }), ctx(id));

  it("writes a step, stamps it as a bot, and refuses a person's step with a clear code", async () => {
    const { token } = await mintKey(db, t, "engine", ["board:read", "board:write"]);
    const id = await sent("Route Shop");
    const ok = await (await write(id, token, { followup_drafts: { "1": { text: "A note.", channel: "email", by: "person", at: "1999-01-01" } } })).json();
    expect(ok.lead.followup_drafts["1"]).toMatchObject({ text: "A note.", by: "bot" });
    expect(ok.lead.followup_drafts["1"].at).not.toBe("1999-01-01");
    await writeLead(db, t, { id }, { followup_drafts: { "1": { text: "Mine.", channel: "email" } } }, OLU);
    const no = await (await write(id, token, { followup_drafts: { "1": { text: "Over it.", channel: "email" } } })).json();
    expect(no.refused).toEqual([expect.objectContaining({ field: "followup_drafts.1", reason: "person_wins" })]);
    expect((await getLead(db, t, { id }))?.followup_drafts).toMatchObject({ "1": { text: "Mine.", by: "person" } });
    expect((await write(id, token, { followup_drafts: { "2": { text: "x", skip: "y", channel: "email" } } })).status).toBe(400);
  });

  it("GET /v1/follow-ups gives the next step of each lead, with no text and no names", async () => {
    const { token } = await mintKey(db, t, "engine", ["board:read"]);
    await sent("Plan Shop", { followup_drafts: { "1": { text: "Private words.", channel: "email" } } });
    const res = await plan(new Request("http://peek.test/v1/follow-ups", { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([expect.objectContaining({ step: 1, channel: "email", draft: "ready" })]);
    expect(JSON.stringify(body)).not.toMatch(/Private words|Plan Shop|Olu/);
    expect((await plan(new Request("http://peek.test/v1/follow-ups"))).status).toBe(401);
  });
});

describe("the count every page asks for (876)", () => {
  it("is exactly the length of the list, through skips, drafts and later steps", async () => {
    const a = await sent("Count One");
    const b = await sent("Count Two");
    const c = await sent("Count Three");
    const d2 = await sent("Count Four");
    await sent("Count Five");
    await db.update(leads).set({ followupDrafts: { 1: { skip: "no point" } } as never }).where(eq(leads.id, a));
    await db.update(leads).set({ draftFollowup: "  SKIP: not this one" }).where(eq(leads.id, b));
    await db.update(leads).set({ followupDrafts: { 2: { skip: "later step only" } } as never }).where(eq(leads.id, c));
    await db.update(leads).set({ followupDrafts: { 1: { text: "Hello again", by: "person", channel: "email" } } as never }).where(eq(leads.id, d2));
    for (const days of [1, 2, 3, 6, 15]) expect(await followUpCount(db, t, "Olu", after(days))).toBe((await followUpsDue(db, t, "Olu", after(days))).length);
    expect(await followUpCount(db, t, "Nobody", after(3))).toBe(0);
  });
});

