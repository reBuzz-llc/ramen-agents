// Follow up and record the result: the week's key results are replies and meetings, and most small
// businesses answer a short second note, not the first. On the Clock home, a person sees the leads they sent four or
// more working days ago with no result and no follow-up yet (oldest first, ten at most), each with the original draft
// and a follow-up to copy: the agents' draft_followup when one is written, else a two-line note from the lead's package,
// which the person edits before copying. "Follow-up sent" records follow_up_at and follow_up_by as that person (cells only
// a person writes, in History). Beside it, their recent sends still waiting for an answer, with the result chips, so a
// reply is recorded in two clicks. Peek never sends anything: the person sends from their own mailbox.
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { leads } from "./db/schema";
import { WHATSAPP_SENT, writeLead, type Actor } from "./leads";

export const FOLLOW_UP_AFTER = 4; // working days
export const FOLLOW_UP_LIMIT = 10;
export const RECENT_DAYS = 14;

export type SentLead = {
  id: string;
  business: string;
  contact: string | null;
  email: string | null;
  pkg: string | null;
  draft: string | null;
  followUp: string;
  followUpByAgent: boolean;
  sentAt: string;
};

/** The day `n` working days (Monday to Friday) before `now`, as YYYY-MM-DD: a lead sent on or before it is due. */
export function workingDaysBefore(now: Date, n: number): string {
  const d = new Date(now);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The two-line follow-up when no agent has written one: the contact's first name, the package, a short question. */
export function followUpTemplate(l: { business: string; contact: string | null; pkg: string | null }): string {
  const first = (l.contact ?? "").trim().split(/[\s,]+/)[0];
  const hi = first && /^[A-Za-z][A-Za-z'-]+$/.test(first) ? `Hi ${first},` : "Hi,";
  const what = l.pkg?.trim() ? `${l.pkg.trim()} for ${l.business}` : `the idea I sent for ${l.business}`;
  return `${hi} a quick follow-up on my note last week about ${what}.\nWould a 15-minute call this week be useful, or should I send the details by email?`;
}

const sentByMe = (name: string) => sql`${leads.sentBy} @> ARRAY[${name}]::text[]`;
const isSent = or(eq(leads.emailStatus, "Email Sent"), eq(leads.whatsappStatus, WHATSAPP_SENT));

function shape(r: { id: string; business: string; contact: string | null; email: string | null; pkg: string | null; draft: string | null; draftFollowup: string | null; sentAt: Date | null }): SentLead {
  const agent = !!r.draftFollowup?.trim() && !/^skip\s*:/i.test(r.draftFollowup.trim());
  return {
    id: r.id,
    business: r.business,
    contact: r.contact,
    email: r.email,
    pkg: r.pkg,
    draft: r.draft,
    followUp: agent ? r.draftFollowup!.trim() : followUpTemplate(r),
    followUpByAgent: agent,
    sentAt: (r.sentAt ?? new Date(0)).toISOString(),
  };
}

const cols = { id: leads.id, business: leads.business, contact: leads.contactPerson, email: leads.businessEmail, pkg: leads.package, draft: leads.draftEmail, draftFollowup: leads.draftFollowup, sentAt: leads.sentAt };

/** The person's follow-ups due: their sends four or more working days old, no result, no follow-up yet, oldest first. */
export async function followUpsDue(db: Db, tenantId: string, name: string, now = new Date()): Promise<SentLead[]> {
  const cutoff = new Date(`${workingDaysBefore(now, FOLLOW_UP_AFTER)}T23:59:59`);
  const rows = await db
    .select(cols)
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.archived, false), sentByMe(name), isSent, isNull(leads.result), isNull(leads.followUpAt), lte(leads.sentAt, cutoff)))
    .orderBy(asc(leads.sentAt))
    .limit(FOLLOW_UP_LIMIT);
  return rows.map(shape);
}

/** The person's recent sends still waiting for an answer (not yet due a follow-up), newest first: where a reply is
 *  recorded. */
export async function sentWaiting(db: Db, tenantId: string, name: string, now = new Date()): Promise<SentLead[]> {
  const cutoff = new Date(`${workingDaysBefore(now, FOLLOW_UP_AFTER)}T23:59:59`);
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const rows = await db
    .select(cols)
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.archived, false), sentByMe(name), isSent, isNull(leads.result), gte(leads.sentAt, since), or(sql`${leads.sentAt} > ${cutoff}`, sql`${leads.followUpAt} is not null`)))
    .orderBy(desc(leads.sentAt))
    .limit(20);
  return rows.map(shape);
}

/** "Follow-up sent": today and the person, on a lead that was sent; nothing is sent by Peek. */
export async function markFollowUp(db: Db, tenantId: string, leadId: string, who: { userId: string; name: string }, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const [l] = await db.select({ id: leads.id, emailStatus: leads.emailStatus, whatsappStatus: leads.whatsappStatus }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  if (!l) return { ok: false, error: "No such lead." };
  if (l.emailStatus !== "Email Sent" && l.whatsappStatus !== WHATSAPP_SENT) return { ok: false, error: "This lead was not sent yet: send the first message before a follow-up." };
  const actor: Actor = { kind: "person", name: who.name, userId: who.userId };
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const r = await writeLead(db, tenantId, { id: leadId }, { follow_up_at: day, follow_up_by: [who.name] }, actor);
  return r.ok ? { ok: true } : { ok: false, error: r.message };
}

/** Follow-ups sent in a week (This week's own line), per person name. */
export async function followUpsSince(db: Db, tenantId: string, from: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ by: leads.followUpBy })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), gte(leads.followUpAt, from)));
  const out = new Map<string, number>();
  for (const r of rows) for (const n of r.by ?? []) out.set(n, (out.get(n) ?? 0) + 1);
  return out;
}
