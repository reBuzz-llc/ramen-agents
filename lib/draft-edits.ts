// A person's fixes to the agents' drafts: the pack and the WhatsApp tab edit a draft in place, and
// these read what people changed from the lead's history (lead_cells): when a lead's draft was last edited by a person
// (a flag raised before that is marked "you changed the draft since"), and how many drafts each person fixed this week.
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db } from "./db";
import { leadCells, leads } from "./db/schema";

export type DraftField = "draft_email" | "draft_whatsapp";

/** Lead id -> the last time a person edited that draft (only leads a person edited). */
export async function lastPersonEdit(db: Db, tenantId: string, ids: string[], field: DraftField): Promise<Map<string, Date>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ leadId: leadCells.leadId, at: sql<Date>`max(${leadCells.at})` })
    .from(leadCells)
    .where(and(eq(leadCells.tenantId, tenantId), inArray(leadCells.leadId, ids), eq(leadCells.column, field), eq(leadCells.actorKind, "person"), sql`coalesce(${leadCells.outcome}, 'applied') = 'applied'`))
    .groupBy(leadCells.leadId);
  return new Map(rows.map((r) => [r.leadId, new Date(r.at)]));
}

/** Drafts (email or WhatsApp) each person fixed since `from` (YYYY-MM-DD): distinct leads, by the person's name. */
export async function draftsFixedSince(db: Db, tenantId: string, from: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ name: leadCells.actorName, n: sql<number>`count(distinct ${leadCells.leadId})` })
    .from(leadCells)
    .where(and(eq(leadCells.tenantId, tenantId), eq(leadCells.actorKind, "person"), inArray(leadCells.column, ["draft_email", "draft_whatsapp"]), gte(leadCells.at, new Date(`${from}T00:00:00`)), sql`coalesce(${leadCells.outcome}, 'applied') = 'applied'`))
    .groupBy(leadCells.actorName);
  return new Map(rows.map((r) => [r.name, Number(r.n)]));
}

/** How many leads each person (by user id, never by name) wrote these columns on since `from`
 *  (YYYY-MM-DD) -- the drafts fixed (draft_email, draft_whatsapp) or the follow-ups marked sent (follow_up_by). */
export async function personLeadsSince(db: Db, tenantId: string, columns: string[], from: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: leadCells.actorUserId, n: sql<number>`count(distinct ${leadCells.leadId})` })
    .from(leadCells)
    .where(and(eq(leadCells.tenantId, tenantId), eq(leadCells.actorKind, "person"), isNotNull(leadCells.actorUserId), inArray(leadCells.column, columns),
      gte(leadCells.at, new Date(`${from}T00:00:00`)), sql`coalesce(${leadCells.outcome}, 'applied') = 'applied'`))
    .groupBy(leadCells.actorUserId);
  return new Map(rows.map((r) => [r.id as string, Number(r.n)]));
}

/** "Drafts fixed": leads where a person rewrote an agent's email or WhatsApp draft since `from`. Writing into an empty cell,
 *  or editing a person's own text, is not a fix of an agent's draft. By user id. */
export async function agentDraftsFixedSince(db: Db, tenantId: string, from: Date, until?: Date): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: leadCells.actorUserId, n: sql<number>`count(distinct ${leadCells.leadId})` })
    .from(leadCells)
    .innerJoin(leads, eq(leads.id, leadCells.leadId))
    .where(and(eq(leadCells.tenantId, tenantId), eq(leadCells.actorKind, "person"), isNotNull(leadCells.actorUserId), inArray(leadCells.column, ["draft_email", "draft_whatsapp"]), gte(leadCells.at, from), until ? lt(leadCells.at, until) : undefined,
      sql`coalesce(${leadCells.outcome}, 'applied') = 'applied'`, sql`${leadCells.old} is not null and ${leadCells.old}::text not in ('null', '""')`,
      sql`((${leadCells.column} = 'draft_email' and ${leads.botDraft} is not null) or (${leadCells.column} = 'draft_whatsapp' and ${leads.botWhatsapp} is not null))`))
    .groupBy(leadCells.actorUserId);
  return new Map(rows.map((r) => [r.id as string, Number(r.n)]));
}

/** A flag's line: whether a person changed the draft after the flag was first raised. */
export const changedSince = (firstSeen: Date | string, edited: Date | undefined) => !!edited && edited.getTime() > new Date(firstSeen).getTime();
