// A clock left running is flagged and holds its week's statement until a person closes it with the real end
// time; nothing closes or caps it by itself. Taken counts only what is not sent yet, follow-ups count in a day's sends on Week as on
// the Clock, and "Drafts fixed" is a person's rewrite of an agent's draft. Invented people and businesses.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as closeRoute } from "@/app/api/shifts/[id]/close/route";
import { accept, holderOf, takenCounts, takenLeads } from "@/lib/claims";
import { memoryDb, type Db } from "@/lib/db";
import { shiftEdits, shifts, statements } from "@/lib/db/schema";
import { agentDraftsFixedSince } from "@/lib/draft-edits";
import { followUpsIn, markFollowUp } from "@/lib/follow-up";
import { writeLead, type Actor } from "@/lib/leads";
import { canFixClock, closeClockFor, correctClock, isLongOpen, longOpenInWeek, longOpenLine, longOpenShifts, shiftEditsOf, StatementBlocked } from "@/lib/open-clock";
import { todayOf } from "@/lib/send-goals-db";
import { approve } from "@/lib/statements";
import { addUser, closeForgotten, createTenant } from "@/lib/tenants";
import { users } from "@/lib/db/schema";
import { weekStart } from "@/lib/week";

const h = vi.hoisted(() => ({ db: null as unknown, who: null as unknown }));
vi.mock("@/lib/db", async (real) => ({ ...(await real<typeof import("@/lib/db")>()), db: async () => h.db }));
vi.mock("@/lib/auth", () => ({ me: async () => h.who, sessionHint: async () => null }));

const HOUR = 3_600_000;
const BOT: Actor = { kind: "bot", name: "Outreach Writer", via: "engine" };
let db: Db;
let t: string;
let ownerId: string;
let managerId: string;
let memberId: string;
let otherId: string;
const OWNER = () => ({ userId: ownerId, name: "Olu", role: "owner" });
const MANAGER = () => ({ userId: managerId, name: "Mia", role: "manager" });
const person = (userId: string, role: string, name: string) => ({ userId, tenantId: t, role, name, email: `${name.toLowerCase()}@acme.example`, acked: true, settings: {} });
const openShift = async (hoursAgo: number, userId = memberId) => (await db.insert(shifts).values({ tenantId: t, userId, startedAt: new Date(Date.now() - hoursAgo * HOUR) }).returning())[0];
const press = (id: string, b: object) => closeRoute(new Request(`http://peek.test/api/shifts/${id}/close`, { method: "POST", headers: { origin: "http://peek.test", host: "peek.test", "content-type": "application/json" }, body: JSON.stringify(b) }), { params: Promise.resolve({ id }) });
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR).toISOString();
const weekOf = (d: Date) => weekStart(d, 1);
const bounds = (w: string) => { const from = new Date(`${w}T00:00:00`); const to = new Date(from); to.setDate(to.getDate() + 7); return { from, to }; };

beforeEach(async () => {
  db = await memoryDb();
  h.db = db;
  const made = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  t = made.tenant.id;
  ownerId = made.owner.id;
  managerId = (await addUser(db, t, "mia@acme.example", "Mia")).id;
  await db.update(users).set({ role: "manager" }).where(eq(users.id, managerId));
  memberId = (await addUser(db, t, "sam@acme.example", "Sam")).id;
  otherId = (await addUser(db, t, "ana@acme.example", "Ana")).id;
});

describe("a clock left running", () => {
  it("is flagged only past 14 hours", async () => {
    const now = new Date();
    expect(isLongOpen(new Date(now.getTime() - 14 * HOUR), now)).toBe(false);
    expect(isLongOpen(new Date(now.getTime() - 14 * HOUR - 1), now)).toBe(true);
    await openShift(13, otherId);
    const s = await openShift(30);
    const m = await longOpenShifts(db, t);
    expect([...m.keys()]).toEqual([memberId]);
    expect(m.get(memberId)).toMatchObject({ shiftId: s.id, hours: 30 });
    expect(longOpenLine(30)).toContain("30 hours");
  });

  it("holds that week's statement until it is closed, and changes no hours by itself", async () => {
    const s = await openShift(30);
    const w = weekOf(s.startedAt);
    await expect(approve(db, t, memberId, w, ownerId)).rejects.toBeInstanceOf(StatementBlocked);
    expect(await db.select().from(statements)).toEqual([]);
    expect((await db.select().from(shifts).where(eq(shifts.id, s.id)))[0].endedAt).toBeNull();
    await closeClockFor(db, t, s.id, iso(22), OWNER());
    expect(await longOpenInWeek(db, t, memberId, bounds(w).from, bounds(w).to)).toBeNull();
    expect((await approve(db, t, memberId, w, ownerId))?.approved).not.toBeNull();
  });

  it("does not hold a statement for a shift still within a working day", async () => {
    const s = await openShift(3);
    expect((await approve(db, t, memberId, weekOf(s.startedAt), ownerId))?.approved).not.toBeNull();
  });
});

describe("who can close it", () => {
  it("the member closes their own from the Clock", async () => {
    const s = await openShift(30);
    expect(await closeForgotten(db, t, memberId, s.id, new Date(iso(22)))).toMatchObject({ ok: true });
  });

  it("a manager closes a member's, and it is recorded", async () => {
    const s = await openShift(30);
    h.who = person(managerId, "manager", "Mia");
    const end = iso(22);
    expect((await press(s.id, { action: "close", at: end })).status).toBe(200);
    expect((await db.select().from(shifts).where(eq(shifts.id, s.id)))[0].endedAt?.toISOString()).toBe(end);
    expect((await db.select().from(shiftEdits))[0]).toMatchObject({ action: "close", oldEnd: null, byUser: managerId, byName: "Mia", byRole: "manager", userId: memberId });
    expect((await shiftEditsOf(db, t, memberId, new Date(0)))[0]).toMatchObject({ action: "close", endedAt: end, by: "Mia" });
  });

  it("an owner closes a manager's or a member's", async () => {
    const a = await openShift(30);
    const b = await openShift(30, managerId);
    h.who = person(ownerId, "owner", "Olu");
    expect((await press(a.id, { action: "close", at: iso(22) })).status).toBe(200);
    expect((await press(b.id, { action: "close", at: iso(22) })).status).toBe(200);
  });

  it("a member cannot touch someone else's, and a manager cannot touch an owner's, another manager's or their own", async () => {
    const s = await openShift(30);
    h.who = person(otherId, "member", "Ana");
    expect((await press(s.id, { action: "close", at: iso(22) })).status).toBe(403);
    h.who = person(memberId, "member", "Sam");
    expect((await press(s.id, { action: "close", at: iso(22) })).status).toBe(403);
    h.who = null;
    expect((await press(s.id, { action: "close", at: iso(22) })).status).toBe(401);
    expect((await db.select().from(shifts).where(eq(shifts.id, s.id)))[0].endedAt).toBeNull();
    expect(canFixClock(MANAGER(), { id: ownerId, role: "owner" })).toBe(false);
    expect(canFixClock(MANAGER(), { id: "x", role: "manager" })).toBe(false);
    expect(canFixClock(MANAGER(), { id: managerId, role: "manager" })).toBe(false);
    expect(canFixClock(OWNER(), { id: ownerId, role: "owner" })).toBe(false);
    expect(canFixClock(OWNER(), { id: managerId, role: "manager" })).toBe(true);
  });

  it("needs a real end: none, in the future, or before the start is refused; nothing defaults to now", async () => {
    const s = await openShift(30);
    for (const at of [undefined, "", "not a time", iso(-1), iso(31)]) await expect(closeClockFor(db, t, s.id, at, OWNER())).rejects.toMatchObject({ status: 400 });
    expect((await db.select().from(shifts).where(eq(shifts.id, s.id)))[0].endedAt).toBeNull();
    expect(await db.select().from(shiftEdits)).toEqual([]);
  });

  it("will not close a clock under 14 hours: the person may be working", async () => {
    const s = await openShift(5);
    await expect(closeClockFor(db, t, s.id, iso(1), OWNER())).rejects.toMatchObject({ status: 409 });
  });
});

describe("a correction", () => {
  it("is an owner's or manager's edit, recorded with the end before and after", async () => {
    const s = await openShift(30);
    const first = iso(22);
    await closeClockFor(db, t, s.id, first, MANAGER());
    const second = iso(21);
    await correctClock(db, t, s.id, second, OWNER(), {});
    const rows = (await db.select().from(shiftEdits)).filter((e) => e.action === "correct");
    expect(rows[0].oldEnd?.toISOString()).toBe(first);
    expect(rows[0].newEnd.toISOString()).toBe(second);
    expect((await shiftEditsOf(db, t, memberId, new Date(0)))[0]).toMatchObject({ action: "correct", endedAt: second, by: "Olu" });
  });

  it("is refused on a shift nobody closed for the member, and on a week already approved", async () => {
    const own = (await db.insert(shifts).values({ tenantId: t, userId: memberId, startedAt: new Date(iso(30)), endedAt: new Date(iso(29)) }).returning())[0];
    await expect(correctClock(db, t, own.id, iso(28), OWNER(), {})).rejects.toThrow(/closed for the member/);
    const s = await openShift(30);
    await closeClockFor(db, t, s.id, iso(22), OWNER());
    await approve(db, t, memberId, weekOf(s.startedAt), ownerId);
    await expect(correctClock(db, t, s.id, iso(21), OWNER(), {})).rejects.toThrow(/approved and frozen/);
  });
});

describe("Taken, sends and drafts on Week", () => {
  const lead = async (business: string, extra: Record<string, unknown> = {}) => {
    const r = await writeLead(db, t, {}, { business, website: `https://${business.replace(/\W/g, "").toLowerCase()}.example`, draft_email: `Hi ${business}`, ...extra }, BOT, { create: true });
    if (!r.ok) throw new Error(r.message);
    return String(r.lead.id);
  };
  const SAM = (): Actor => ({ kind: "person", name: "Sam", userId: memberId });

  it("Taken leaves out a lead already sent, even from an old row, and a send clears the hold", async () => {
    const waiting = await lead("Waiting Shop");
    const sent = await lead("Sent Shop");
    await accept(db, t, waiting, memberId);
    await accept(db, t, sent, memberId);
    expect((await takenCounts(db, t)).get(memberId)).toBe(2);
    await writeLead(db, t, { id: sent }, { email_status: "Email Sent" }, SAM());
    expect(await holderOf(db, t, sent)).toBeNull();
    expect((await takenCounts(db, t)).get(memberId)).toBe(1);
    expect((await takenLeads(db, t, memberId)).map((l) => l.business)).toEqual(["Waiting Shop"]);
  });

  it("a WhatsApp send clears the hold too, and any other edit does not", async () => {
    const id = await lead("Chat Shop");
    await accept(db, t, id, memberId);
    await writeLead(db, t, { id }, { notes: "called them" }, SAM());
    expect(await holderOf(db, t, id)).not.toBeNull();
    await writeLead(db, t, { id }, { whatsapp_status: "WhatsApp msg sent" }, SAM());
    expect(await holderOf(db, t, id)).toBeNull();
  });

  it("counts follow-ups by channel in the same window, with the same numbers the Clock adds", async () => {
    const now = new Date();
    const at = new Date(now.getTime() - 3 * 86_400_000);
    const a = await lead("Mail Shop");
    const b = await lead("Chat Note Shop", { followup_drafts: { "1": { text: "Hi", channel: "whatsapp" } } });
    for (const id of [a, b]) await writeLead(db, t, { id }, { email_status: "Email Sent" }, SAM(), { sentAt: at });
    const before = await todayOf(db, t, memberId, now);
    for (const id of [a, b]) await markFollowUp(db, t, id, { userId: memberId, name: "Sam" }, now);
    const after = await todayOf(db, t, memberId, now);
    const week = (await followUpsIn(db, t, new Date(now.getTime() - 1000), new Date(now.getTime() + 1000))).get(memberId);
    expect(week).toEqual({ email: 1, whatsapp: 1 });
    expect(after.email.sent - before.email.sent).toBe(week?.email);
    expect(after.whatsapp.sent - before.whatsapp.sent).toBe(week?.whatsapp);
    expect((await followUpsIn(db, t, new Date(now.getTime() + 1000))).size).toBe(0);
  });

  it("Drafts fixed counts a person's rewrite of an agent's draft, not writing into an empty cell or editing their own", async () => {
    const from = new Date(Date.now() - 1000);
    const agent = await lead("Agent Draft Shop");
    await writeLead(db, t, { id: agent }, { draft_email: "A person's better draft." }, SAM());
    const empty = await writeLead(db, t, {}, { business: "Empty Draft Shop", website: "https://emptydraft.example" }, BOT, { create: true });
    if (!empty.ok) throw new Error("setup");
    await writeLead(db, t, { id: empty.lead.id }, { draft_whatsapp: "Written from nothing." }, SAM());
    expect((await agentDraftsFixedSince(db, t, from)).get(memberId)).toBe(1);
    await writeLead(db, t, { id: empty.lead.id }, { draft_whatsapp: "Their own text, edited." }, SAM());
    expect((await agentDraftsFixedSince(db, t, from)).get(memberId)).toBe(1);
  });
});

describe("what a reply is", () => {
  it("says on the Week page and the statement that any answer counts, including not interested", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["app/week/page.tsx", "app/week/statement/[userId]/page.tsx"]) expect(readFileSync(f, "utf8")).toContain("Any answer counts as a reply, including &ldquo;not interested&rdquo;.");
    expect(readFileSync("app/api/statement/route.ts", "utf8")).toContain('Any answer counts as a reply, including "not interested".');
  });
});
