// Follow up and record the result (the Follow up tab). Up to three
// follow-ups, 2, 5 and 14 days after the send, on a lead with no answer yet (Result empty or "Emailed", which the send pack writes
// on every send). One list feeds the Follow up tab, the Clock's card and the count on the Leads link. A lead on hold or with a
// skip for its step is off it. There is no generic template: until the Writer supplies a draft for the step, or a person
// writes one, the row says "no draft yet". "Mark sent" records the step as that person. Peek never sends anything.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { leadFollowUps, leads, samples } from "./db/schema";
import { draftHold, FOLLOW_UP_DAYS, nextStep, type FollowUpChannel, type FollowUpDrafts, type StepKey } from "./follow-up-drafts";
import { notHeld } from "./held-drafts";
import { WHATSAPP_SENT, writeLead, type Actor } from "./leads";

export { FOLLOW_UP_LIMIT } from "./follow-up-limit";
export const RECENT_DAYS = 14;
const DAY = 86_400_000;

export type SentLead = {
  id: string;
  business: string;
  contact: string | null;
  email: string | null;
  whatsapp: string | null;
  pkg: string | null;
  /** What was sent first, on this step's channel. */
  draft: string | null;
  step: 1 | 2 | 3;
  dueAt: string;
  channel: FollowUpChannel;
  /** This step's draft, or "" for no draft yet. */
  followUp: string;
  followUpBy: "bot" | "person" | null;
  /** Why the draft may not be copied (it claims what we have not done, or links to no live sample), or "". */
  hold: string;
  sentAt: string;
  sentBy: string[];
};
export type WaitingLead = { id: string; business: string; sentAt: string };
export type PlanRow = { leadId: string; step: 1 | 2 | 3; dueAt: string; due: boolean; channel: FollowUpChannel; draft: "none" | "ready" | "person" | "skip" | "held" };

// the person's own sends, under any name they were recorded with (namesOf: the shown name, and the full address older
// records carry)
const sentByMe = (names: string | string[]) => {
  const list = Array.isArray(names) ? names : [names];
  return sql`${leads.sentBy} && ARRAY[${sql.join(list.map((n) => sql`${n}`), sql`, `)}]::text[]`;
};
const isSent = or(eq(leads.emailStatus, "Email Sent"), eq(leads.whatsappStatus, WHATSAPP_SENT));
const noAnswer = or(isNull(leads.result), eq(leads.result, "Emailed"));
const SKIP_CELL = /^\s*skip\s*:/i;
const channelOf = (emailStatus: string | null): FollowUpChannel => (emailStatus === "Email Sent" ? "email" : "whatsapp");

const stepsWhere = (tenantId: string, who: string | string[] | null, now: Date, upcoming: boolean) =>
  and(eq(leads.tenantId, tenantId), eq(leads.archived, false), isSent, noAnswer, notHeld, isNotNull(leads.sentAt), who === null ? undefined : sentByMe(who), upcoming ? undefined : lte(leads.sentAt, new Date(now.getTime() - FOLLOW_UP_DAYS[0] * DAY)));

/** Every lead with a next step: its step, when it is due and its stored draft. `who` null is everyone's. */
async function steps(db: Db, tenantId: string, who: string | string[] | null, now: Date, upcoming: boolean) {
  const rows = await db
    .select({
      id: leads.id,
      sentAt: leads.sentAt,
      emailStatus: leads.emailStatus,
      drafts: leads.followupDrafts,
      oldCell: leads.draftFollowup,
      done: sql<{ step: number; at: string }[]>`coalesce((select jsonb_agg(jsonb_build_object('step', f.step, 'at', f.sent_at)) from lead_follow_ups f where f.lead_id = "leads"."id"), '[]'::jsonb)`,
    })
    .from(leads)
    .where(stepsWhere(tenantId, who, now, upcoming));
  return rows.flatMap((r) => {
    const next = nextStep(r.sentAt!, r.done.map((d) => ({ step: d.step, sentAt: new Date(d.at) })));
    if (!next || (!upcoming && next.dueAt > now)) return [];
    const stored = (r.drafts as FollowUpDrafts | null)?.[String(next.step) as StepKey];
    const skip = SKIP_CELL.test(r.oldCell ?? "") || (!!stored && "skip" in stored);
    return [{ id: r.id, emailStatus: r.emailStatus, ...next, stored, skip }];
  });
}

/** What each lead's sample allows a follow-up to say: an approved sample, and the address of a live one. */
async function sampleFacts(db: Db, tenantId: string, ids: string[]) {
  const out = new Map<string, { approved: boolean; liveUrl: string }>();
  if (!ids.length) return out;
  const rows = await db.select({ leadId: samples.leadId, status: samples.status, approvedVersion: samples.approvedVersion, url: samples.url }).from(samples).where(and(eq(samples.tenantId, tenantId), inArray(samples.leadId, ids)));
  for (const s of rows) {
    const had = out.get(s.leadId) ?? { approved: false, liveUrl: "" };
    const approved = ["approved", "live", "frozen"].includes(s.status) || (s.approvedVersion !== null && s.status !== "taken_down");
    out.set(s.leadId, { approved: had.approved || approved, liveUrl: s.status === "live" && s.url.startsWith("https://") ? s.url : had.liveUrl });
  }
  return out;
}

/** The follow-ups due, oldest due first: the person's own sends, or everyone's with `who` null. */
export async function followUpsDue(db: Db, tenantId: string, who: string | string[] | null, now = new Date()): Promise<SentLead[]> {
  const due = (await steps(db, tenantId, who, now, false)).filter((s) => !s.skip);
  if (!due.length) return [];
  const ids = due.map((s) => s.id);
  const [rows, facts] = await Promise.all([
    db
      .select({ id: leads.id, business: leads.business, contact: leads.contactPerson, email: leads.businessEmail, whatsapp: leads.whatsapp, pkg: leads.package, draftEmail: leads.draftEmail, draftWhatsapp: leads.draftWhatsapp, sentAt: leads.sentAt, sentBy: leads.sentBy })
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), inArray(leads.id, ids))),
    sampleFacts(db, tenantId, ids),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return due
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .flatMap((s) => {
      const r = byId.get(s.id);
      if (!r) return [];
      const text = s.stored && "text" in s.stored ? s.stored.text : "";
      const channel = s.stored && "text" in s.stored ? s.stored.channel : channelOf(s.emailStatus);
      return [{
        id: r.id,
        business: r.business,
        contact: r.contact,
        email: r.email,
        whatsapp: r.whatsapp,
        pkg: r.pkg,
        draft: channel === "email" ? r.draftEmail : r.draftWhatsapp,
        step: s.step,
        dueAt: s.dueAt.toISOString(),
        channel,
        followUp: text,
        followUpBy: text ? s.stored!.by : null,
        hold: text ? draftHold(text, facts.get(r.id) ?? { approved: false, liveUrl: "" }) : "",
        sentAt: (r.sentAt ?? new Date(0)).toISOString(),
        sentBy: r.sentBy ?? [],
      }];
    });
}

/** How many are due: the count on the tab and the Leads link. */
export async function followUpCount(db: Db, tenantId: string, who: string | string[] | null, now = new Date()): Promise<number> {
  // Every page asks this, so it reads which steps are skipped and not the drafts' text. Same rule as `steps`.
  const rows = await db
    .select({
      sentAt: leads.sentAt,
      oldSkip: sql<boolean>`coalesce(${leads.draftFollowup} ~* '^\\s*skip\\s*:', false)`,
      skips: sql<string[]>`coalesce((select array_agg(e.key) from jsonb_each(case when jsonb_typeof(${leads.followupDrafts}) = 'object' then ${leads.followupDrafts} else '{}'::jsonb end) e where jsonb_typeof(e.value) = 'object' and e.value ? 'skip'), '{}')`,
      done: sql<{ step: number; at: string }[]>`coalesce((select jsonb_agg(jsonb_build_object('step', f.step, 'at', f.sent_at)) from lead_follow_ups f where f.lead_id = "leads"."id"), '[]'::jsonb)`,
    })
    .from(leads)
    .where(stepsWhere(tenantId, who, now, false));
  let due = 0;
  for (const r of rows) {
    const next = nextStep(r.sentAt!, r.done.map((d) => ({ step: d.step, sentAt: new Date(d.at) })));
    if (next && next.dueAt <= now && !r.oldSkip && !r.skips.includes(String(next.step))) due++;
  }
  return due;
}

/** For the engine (GET /v1/follow-ups, 818): each lead's next step, due or not, and whether it has a draft. No text, no names. */
export async function followUpPlan(db: Db, tenantId: string, now = new Date()): Promise<PlanRow[]> {
  const all = await steps(db, tenantId, null, now, true);
  const facts = await sampleFacts(db, tenantId, all.map((s) => s.id));
  return all
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .map((s) => {
      const text = s.stored && "text" in s.stored ? s.stored.text : "";
      const held = !!text && !!draftHold(text, facts.get(s.id) ?? { approved: false, liveUrl: "" });
      const draft: PlanRow["draft"] = s.skip ? "skip" : !text ? "none" : held ? "held" : s.stored!.by === "person" ? "person" : "ready";
      return { leadId: s.id, step: s.step, dueAt: s.dueAt.toISOString(), due: s.dueAt <= now, channel: s.stored && "text" in s.stored ? s.stored.channel : channelOf(s.emailStatus), draft };
    });
}

/** The person's recent sends still waiting for an answer and not due a follow-up now, newest first: where a reply is recorded. */
export async function sentWaiting(db: Db, tenantId: string, name: string | string[], now = new Date(), dueNow?: Promise<SentLead[]>): Promise<WaitingLead[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY);
  const [rows, due] = await Promise.all([
    db
      .select({ id: leads.id, business: leads.business, sentAt: leads.sentAt })
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), eq(leads.archived, false), sentByMe(name), isSent, noAnswer, gte(leads.sentAt, since)))
      .orderBy(desc(leads.sentAt)),
    dueNow ?? followUpsDue(db, tenantId, name, now),
  ]);
  const dueIds = new Set(due.map((l) => l.id));
  return rows.filter((r) => !dueIds.has(r.id)).slice(0, 20).map((r) => ({ id: r.id, business: r.business, sentAt: (r.sentAt ?? new Date(0)).toISOString() }));
}

/** "Mark sent": this step, today, as the person, on a lead that was sent. Nothing is sent by Peek, and the day's count never blocks
 *  it (a person may already have sent it). A step someone else just recorded is refused, so a follow-up is never counted twice. */
export async function markFollowUp(db: Db, tenantId: string, leadId: string, who: { userId: string; name: string }, now = new Date(), asked: { step?: unknown; channel?: unknown } = {}): Promise<{ ok: true; step: number } | { ok: false; error: string }> {
  const [l] = await db.select({ id: leads.id, emailStatus: leads.emailStatus, whatsappStatus: leads.whatsappStatus, sentAt: leads.sentAt, drafts: leads.followupDrafts }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  if (!l) return { ok: false, error: "No such lead." };
  if (l.emailStatus !== "Email Sent" && l.whatsappStatus !== WHATSAPP_SENT) return { ok: false, error: "This lead was not sent yet: send the first message before a follow-up." };
  const done = await db.select({ step: leadFollowUps.step, sentAt: leadFollowUps.sentAt }).from(leadFollowUps).where(eq(leadFollowUps.leadId, leadId));
  const next = nextStep(l.sentAt ?? now, done);
  if (!next) return { ok: false, error: "This lead already has its three follow-ups." };
  if (asked.step !== undefined && asked.step !== next.step) return { ok: false, error: `Follow-up ${String(asked.step)} is already recorded for this lead.` };
  const stored = (l.drafts as FollowUpDrafts | null)?.[String(next.step) as StepKey];
  const channel: FollowUpChannel = asked.channel === "email" || asked.channel === "whatsapp" ? asked.channel : stored && "text" in stored ? stored.channel : channelOf(l.emailStatus);
  const [row] = await db.insert(leadFollowUps).values({ tenantId, leadId, step: next.step, channel, sentAt: now, byUser: who.userId, byName: who.name }).onConflictDoNothing().returning();
  if (!row) return { ok: false, error: `Follow-up ${next.step} is already recorded for this lead.` };
  const actor: Actor = { kind: "person", name: who.name, userId: who.userId };
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const r = await writeLead(db, tenantId, { id: leadId }, { follow_up_at: day, follow_up_by: [who.name] }, actor);
  if (!r.ok) {
    await db.delete(leadFollowUps).where(eq(leadFollowUps.id, row.id));
    return { ok: false, error: r.message };
  }
  return { ok: true, step: next.step };
}

/** Follow-ups marked sent in a window, per person and channel: one rule with the Clock's day counts. */
export async function followUpsIn(db: Db, tenantId: string, from: Date, until?: Date): Promise<Map<string, { email: number; whatsapp: number }>> {
  const rows = await db
    .select({ id: leadFollowUps.byUser, channel: leadFollowUps.channel, n: sql<number>`count(*)::int` })
    .from(leadFollowUps)
    .where(and(eq(leadFollowUps.tenantId, tenantId), gte(leadFollowUps.sentAt, from), until ? lt(leadFollowUps.sentAt, until) : undefined))
    .groupBy(leadFollowUps.byUser, leadFollowUps.channel);
  const out = new Map<string, { email: number; whatsapp: number }>();
  for (const r of rows) {
    if (!r.id) continue;
    const c = out.get(r.id) ?? { email: 0, whatsapp: 0 };
    c[r.channel === "email" ? "email" : "whatsapp"] += Number(r.n);
    out.set(r.id, c);
  }
  return out;
}

/** Follow-ups sent in a week (This week's own line), per person name. */
export async function followUpsSince(db: Db, tenantId: string, from: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ by: leadFollowUps.byName, n: sql<number>`count(*)::int` })
    .from(leadFollowUps)
    .where(and(eq(leadFollowUps.tenantId, tenantId), gte(leadFollowUps.sentAt, new Date(`${from}T00:00:00`))))
    .groupBy(leadFollowUps.byName)
    .orderBy(asc(leadFollowUps.byName));
  return new Map(rows.map((r) => [r.by, Number(r.n)]));
}
