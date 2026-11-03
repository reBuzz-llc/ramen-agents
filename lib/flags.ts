// The Validator's flags on a lead: raise (one per rule; raising an
// open rule again keeps its id and takes the new detail; a resolved one reopens), resolve, list.
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./db";
import { leadFlags, leads } from "./db/schema";

export type Flag = { id: string; rule: string; detail: string; status: "open" | "resolved"; first_seen: string; resolved_at: string | null; actor: string | null };
const shape = (f: typeof leadFlags.$inferSelect): Flag => ({
  id: f.id,
  rule: f.rule,
  detail: f.detail,
  status: f.status === "resolved" ? "resolved" : "open",
  first_seen: f.firstSeen.toISOString(),
  resolved_at: f.resolvedAt?.toISOString() ?? null,
  actor: f.actor,
});

async function leadOf(db: Db, tenantId: string, leadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return null;
  const [l] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  return l ?? null;
}

export async function raiseFlag(db: Db, tenantId: string, leadId: string, rule: string, detail: string, actor: string): Promise<Flag | null> {
  if (!(await leadOf(db, tenantId, leadId))) return null;
  const r = rule.trim().slice(0, 80);
  const d = detail.trim().slice(0, 2000);
  const [f] = await db
    .insert(leadFlags)
    .values({ tenantId, leadId, rule: r, detail: d, actor })
    .onConflictDoUpdate({ target: [leadFlags.leadId, leadFlags.rule], set: { detail: d, status: "open", resolvedAt: null, actor } })
    .returning();
  return shape(f);
}

export async function resolveFlag(db: Db, tenantId: string, leadId: string, flagId: string, actor: string): Promise<Flag | null> {
  if (!/^[0-9a-f-]{36}$/i.test(flagId)) return null;
  const [f] = await db
    .update(leadFlags)
    .set({ status: "resolved", resolvedAt: new Date(), actor })
    .where(and(eq(leadFlags.tenantId, tenantId), eq(leadFlags.leadId, leadId), eq(leadFlags.id, flagId)))
    .returning();
  return f ? shape(f) : null;
}

export async function flagsOf(db: Db, tenantId: string, leadId: string): Promise<Flag[] | null> {
  if (!(await leadOf(db, tenantId, leadId))) return null;
  const rows = await db.select().from(leadFlags).where(and(eq(leadFlags.tenantId, tenantId), eq(leadFlags.leadId, leadId))).orderBy(asc(leadFlags.firstSeen));
  return rows.map(shape);
}
