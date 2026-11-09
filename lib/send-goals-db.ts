// The daily send goals' queries; the rules and the wording are in lib/send-goals.ts.
import { and, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { leadCells, leads, type TenantSettings } from "./db/schema";
import { WHATSAPP_SENT } from "./leads";
import { ALREADY_SENT_SOURCE, budgetOf, dayStartIn, doneLine, goalsOf, type Budget, type Channel } from "./send-goals";
import { settingsOf } from "./tenants";

/** Each person's sends today, by channel (userId → counts): the History steps described at the top. */
export async function sentTodayByPerson(db: Db, tenantId: string, since: Date): Promise<Map<string, { email: number; whatsapp: number }>> {
  const notBackfill = or(isNull(leadCells.sourceUrl), ne(leadCells.sourceUrl, ALREADY_SENT_SOURCE));
  const rows = await db
    .select({
      userId: leadCells.actorUserId,
      email: sql<number>`count(distinct ${leadCells.leadId}) filter (where ${leadCells.column} = 'email_status' and ${leads.emailStatus} = 'Email Sent')::int`,
      whatsapp: sql<number>`count(distinct ${leadCells.leadId}) filter (where ${leadCells.column} = 'whatsapp_status' and ${leads.whatsappStatus} = ${WHATSAPP_SENT})::int`,
    })
    .from(leadCells)
    .innerJoin(leads, eq(leads.id, leadCells.leadId))
    .where(
      and(
        eq(leadCells.tenantId, tenantId),
        eq(leadCells.actorKind, "person"),
        eq(leadCells.outcome, "applied"),
        gte(leadCells.at, since),
        notBackfill,
        or(
          and(eq(leadCells.column, "email_status"), sql`${leadCells.new} = ${JSON.stringify("Email Sent")}::jsonb`),
          and(eq(leadCells.column, "whatsapp_status"), sql`${leadCells.new} = ${JSON.stringify(WHATSAPP_SENT)}::jsonb`),
        ),
      ),
    )
    .groupBy(leadCells.actorUserId);
  const out = new Map<string, { email: number; whatsapp: number }>();
  for (const r of rows) if (r.userId) out.set(r.userId, { email: Number(r.email), whatsapp: Number(r.whatsapp) });
  return out;
}

/** The person's day so far: sent, goal and what is left, for email and WhatsApp. */
export async function todayOf(db: Db, tenantId: string, userId: string, now = new Date(), settings?: TenantSettings): Promise<Record<Channel, Budget>> {
  const s = settings ?? (await settingsOf(db, tenantId));
  const goals = goalsOf(s);
  const mine = (await sentTodayByPerson(db, tenantId, dayStartIn(now, s.timezone))).get(userId) ?? { email: 0, whatsapp: 0 };
  return { email: budgetOf(mine.email, goals.email), whatsapp: budgetOf(mine.whatsapp, goals.whatsapp) };
}

/** Null when the person may send on these channels today, else the line refusing it. A lead already marked sent on that
 *  channel is no new send (a re-save never counts twice). */
export async function overGoal(db: Db, tenantId: string, userId: string, channels: Channel[], leadId?: string, now = new Date()): Promise<string | null> {
  if (!channels.length) return null;
  let todo = channels;
  if (leadId && /^[0-9a-f-]{36}$/i.test(leadId)) {
    const [l] = await db.select({ email: leads.emailStatus, wa: leads.whatsappStatus }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
    if (l) todo = channels.filter((c) => (c === "email" ? l.email !== "Email Sent" : l.wa !== WHATSAPP_SENT));
  }
  if (!todo.length) return null;
  const t = await todayOf(db, tenantId, userId, now);
  const hit = todo.find((c) => t[c].left <= 0);
  return hit ? doneLine(t[hit].goal) : null;
}
