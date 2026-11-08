// A person's fixes to the agents' drafts: the pack and the WhatsApp tab edit a draft in place, and
// these read what people changed from the lead's history (lead_cells): when a lead's draft was last edited by a person
// (a flag raised before that is marked "you changed the draft since"), and how many drafts each person fixed this week.
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "./db";
import { leadCells } from "./db/schema";

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

/** A flag's line: whether a person changed the draft after the flag was first raised. */
export const changedSince = (firstSeen: Date | string, edited: Date | undefined) => !!edited && edited.getTime() > new Date(firstSeen).getTime();
